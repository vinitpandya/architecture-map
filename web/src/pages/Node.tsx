import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Evidence, type GraphEdge, type GraphNode, type NodeDetail, type Team } from '../lib/api'
import { useQuery, useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'
import { DataGrid, type GridColumn } from '../components/DataGrid'
import { EvidenceList } from '../components/EvidenceList'
import { assignTeam } from '../lib/teams'
import { driftTitle } from '../lib/drift'
import {
  EDGE_LABEL,
  KIND_LABEL,
  VIA_LABEL,
  displayCode,
  idValue,
  nodeHref,
  processHref,
  teamHref,
} from '../lib/nodes'

/**
 * What a node is, who touches it, and where in the source that is written
 * down. The shape of the page follows the kind: the question you have about a
 * Kafka topic is not the question you have about a database, and a single
 * in/out table answers neither of them well.
 *
 * Node ids carry `:`, `/`, spaces and `{}`, so they travel as a query
 * parameter and never as a path segment.
 */
export function NodePage() {
  const [params] = useSearchParams()
  const id = params.get('id') ?? ''
  const [data, setData] = useState<NodeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    if (!id) return
    api
      .get<NodeDetail>('/node', { id })
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(String((err as Error).message)))
    return () => {
      cancelled = true
    }
  }, [id, reload])

  if (!id) return <div className="page"><Empty title="No node selected" /></div>
  if (error) return <div className="page"><Empty title={error}><code>{id}</code></Empty></div>
  if (!data) return null

  const { node } = data

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{node.name}</h1>
          <p>
            <span className="pill">{KIND_LABEL[node.kind]}</span>{' '}
            {node.ownerRepo ? <>owned by <code>{node.ownerRepo}</code></> : 'no owning repo'}
            {node.teamName || node.teamId ? (
              <>
                {' '}
                · <Link to={teamHref(node.teamId!)}>{node.teamName ?? node.teamId}</Link>
              </>
            ) : null}
            {node.language ? <> · {node.language}</> : null}
            {node.engine ? <> · {node.engine}</> : null}
          </p>
        </div>
      </div>

      <code className="muted" style={{ fontSize: 12 }}>{node.id}</code>

      {node.orphan && (
        <p className="muted">
          Referenced by a scanned repository but never declared by one. Either the other end lives
          outside the scanned set, or somebody is talking to something that no longer exists.
        </p>
      )}

      <Description node={node} onSaved={() => setReload((n) => n + 1)} />

      <Owner node={node} onSaved={() => setReload((n) => n + 1)} />

      {data.drift.length > 0 && (
        <Card title={`Findings (${data.drift.length})`} sub="What the link pass noticed about this node">
          <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
            {data.drift.map((f) => (
              <li key={f.id}>
                <strong>{driftTitle(f.kind)}</strong> — {f.detail}
                {f.state === 'accepted' && <span className="muted"> · accepted</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <KindBody detail={data} />

      <Processes detail={data} />

      <Card title="Evidence" sub="Where this node is visible in the source">
        <EvidenceList evidence={data.evidence} />
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ owner */

/**
 * Who this belongs to, for a service.
 *
 * Only a service, because only a service has a team of its own: a topic's
 * comes from whoever produces it, a store's from whoever owns it, and writing
 * an override on one of those would show a correction on this page while every
 * derived column went on saying the other thing. The honest thing to offer on
 * an inherited team is the link to where it actually comes from.
 */
function Owner({ node, onSaved }: { node: GraphNode; onSaved: () => void }) {
  const { data } = useQuery<{ teams: Team[] }>(node.kind === 'service' ? '/teams' : null)
  const { reload } = useScope()
  const [busy, setBusy] = useState(false)
  if (node.kind !== 'service') return null

  const teams = data?.teams ?? []
  const set = async (team: string | null) => {
    setBusy(true)
    try {
      await assignTeam(node.id, team)
      onSaved()
      // A team decides the map's colours, the filter row and every handoff, so
      // the whole app's data is stale, not just this page's.
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <p className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span className="nav-group-label">Team</span>
      <select
        aria-label="Team"
        disabled={busy || !data}
        value={node.teamId ?? ''}
        onChange={(e) => void set(e.target.value ? teams.find((t) => t.id === e.target.value)!.name : '')}
      >
        <option value="">No team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {node.teamVia === 'override' ? (
        <>
          <span className="pill">corrected</span>
          <button type="button" className="ghost" disabled={busy} onClick={() => void set(null)}>
            Revert to the scan
          </button>
        </>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>
          {node.teamVia === 'scan'
            ? 'From service.team in the manifest. A change here outranks it and survives a re-scan.'
            : 'The manifest names no team. A change here is a correction the next scan cannot undo.'}
        </span>
      )}
    </p>
  )
}

/* ------------------------------------------------------------ description */

/**
 * A correction written here becomes an `overrides` row, which ingest never
 * reads or writes. That separation is the whole reason a re-scan cannot eat
 * somebody's work.
 */
function Description({ node, onSaved }: { node: GraphNode; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.description ?? '')
  const [saving, setSaving] = useState(false)

  const save = async (value: string | null) => {
    setSaving(true)
    try {
      if (value === null) {
        await api.del(
          `/override?subjectKind=node&subjectId=${encodeURIComponent(node.id)}&field=description`
        )
      } else {
        await api.put('/override', {
          subjectKind: 'node',
          subjectId: node.id,
          field: 'description',
          value,
        })
      }
      setEditing(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <p>
        {node.description || <span className="muted">No description.</span>}{' '}
        <button
          type="button"
          className="ghost"
          style={{ padding: '1px 6px', fontSize: 12 }}
          onClick={() => {
            setDraft(node.description ?? '')
            setEditing(true)
          }}
        >
          Edit
        </button>
      </p>
    )
  }

  return (
    <form
      className="stack"
      style={{ gap: 8, maxWidth: 680 }}
      onSubmit={(e) => {
        e.preventDefault()
        void save(draft.trim())
      }}
    >
      <textarea
        value={draft}
        rows={3}
        autoFocus
        aria-label="Description"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="primary" disabled={saving}>
          Save correction
        </button>
        <button type="button" className="ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="button" className="ghost" onClick={() => void save(null)} disabled={saving}>
          Revert to the scan
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Corrections live outside the derived topology, so the next scan cannot undo them.
        </span>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------- processes */

/**
 * What the business does here. On a topic this is the payoff — four business
 * processes flow through it, and that is not derivable from the code at all.
 * Deepest first: a level 3 says what actually happens, a level 1 says which
 * part of the business it belongs to.
 */
function Processes({ detail }: { detail: NodeDetail }) {
  const rows = detail.processes ?? []
  // Provenance is `via`, not level. A level 3 can reach a service through the
  // endpoint it calls without naming it, and a level 1 or 2 is allowed to name
  // a component directly — so counting level 3s answered a different question
  // than the sentence asked, and contradicted the "How it uses this" column
  // one line below.
  const named = rows.filter((p) => p.via === 'node' || p.via === 'touches' || p.via === 'interaction')

  return (
    <Card
      title={`Business processes (${rows.length})`}
      sub={
        !rows.length
          ? 'Nothing documented depends on this component'
          : named.length === rows.length
            ? 'Each of them names this component directly'
            : named.length
              ? `${named.length} of them name this component directly; the rest reach it through something else`
              : 'All of them reach it through something else — an endpoint it serves, or a part further down'
      }
    >
      {rows.length ? (
        <DataGrid
          rows={rows}
          rowKey={(p) => p.id}
          storageKey="node-processes"
          defaultSort={null}
          columns={[
            {
              key: 'code',
              label: 'Code',
              value: (p) => p.code,
              render: (p) => <Link to={processHref(p.pack, p.code)}>{displayCode(p.code)}</Link>,
            },
            {
              key: 'name',
              label: 'Process',
              wide: true,
              value: (p) => p.name,
              render: (p) => <Link to={processHref(p.pack, p.code)}>{p.name}</Link>,
            },
            { key: 'level', label: 'Level', align: 'right' as const, value: (p) => p.level },
            { key: 'via', label: 'How it uses this', value: (p) => VIA_LABEL[p.via] ?? p.via },
            { key: 'owner', label: 'Owner', value: (p) => p.owner ?? '' },
          ]}
        />
      ) : (
        <Empty title="No documented process touches this">
          <span className="muted" style={{ fontSize: 12 }}>
            Either a process pack is incomplete, or nothing in the business depends on it. Both are
            worth knowing; neither is invented away.
          </span>
        </Empty>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------- per kind */

function KindBody({ detail }: { detail: NodeDetail }) {
  switch (detail.node.kind) {
    case 'kafka.topic': return <TopicBody detail={detail} />
    case 'service': return <ServiceBody detail={detail} />
    case 'contract': return <ContractBody detail={detail} />
    case 'database':
    case 'cache': return <StoreBody detail={detail} />
    case 'endpoint': return <EndpointBody detail={detail} />
    default: return <ExternalBody detail={detail} />
  }
}

/** The screen this whole project was asked for. */
function TopicBody({ detail }: { detail: NodeDetail }) {
  const producers = detail.in.filter((e) => e.kind === 'kafka.produce')
  const consumers = detail.in.filter((e) => e.kind === 'kafka.consume')
  const contracts = [...new Set(detail.in.map((e) => e.contractId).filter(Boolean))] as string[]
  const skewed = new Set(
    contracts.filter(
      (c) => new Set(detail.bindings.filter((b) => b.contract_id === c).map((b) => b.version)).size > 1
    )
  )

  return (
    <>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card
            title={`Producers (${producers.length})`}
            sub={producers.length ? undefined : 'Nobody in the scanned set writes to this topic'}
          >
            {producers.length ? (
              <PartyGrid rows={producers} detail={detail} side="from" storageKey="topic-producers" />
            ) : (
              <Empty title="No producer">
                <span className="muted" style={{ fontSize: 12 }}>
                  Either another team owns it, or every listener below is dead. Both are worth
                  knowing; neither is smoothed over.
                </span>
              </Empty>
            )}
          </Card>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Card title={`Consumers (${consumers.length})`}>
            {consumers.length ? (
              <PartyGrid rows={consumers} detail={detail} side="from" storageKey="topic-consumers" />
            ) : (
              <Empty title="Nothing reads this topic" />
            )}
          </Card>
        </div>
      </div>

      {contracts.length > 0 && (
        <Card
          title="Payload"
          sub={
            skewed.size
              ? 'These services are not all on the same version of what this topic carries'
              : 'Every service on this topic binds the same version'
          }
        >
          {contracts.map((c) => (
            <div key={c} style={{ marginBottom: 10 }}>
              <p style={{ margin: '0 0 6px' }}>
                <Link to={nodeHref(c)}>{idValue(c)}</Link>{' '}
                {skewed.has(c) && (
                  <span className="pill" style={{ color: 'var(--status-critical)' }}>
                    version skew
                  </span>
                )}
              </p>
              <BindingGrid
                bindings={detail.bindings.filter((b) => b.contract_id === c)}
                storageKey="topic-bindings"
              />
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

function ServiceBody({ detail }: { detail: NodeDetail }) {
  const out = (kinds: string[]) => detail.out.filter((e) => kinds.includes(e.kind))
  const into = (kinds: string[]) => detail.in.filter((e) => kinds.includes(e.kind))

  return (
    <>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Side title="Produces" rows={out(['kafka.produce'])} detail={detail} side="to" storageKey="svc-produces" />
        <Side title="Consumes" rows={out(['kafka.consume'])} detail={detail} side="to" storageKey="svc-consumes" />
      </div>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Side title="Calls" rows={out(['http.call'])} detail={detail} side="to" storageKey="svc-calls" />
        <Side
          title="Called by"
          rows={into(['http.call'])}
          detail={detail}
          side="from"
          storageKey="svc-called-by"
          empty="Nothing in the scanned set calls this service"
        />
      </div>

      <Card title="Stores" sub="Databases and caches this service owns, writes or reads">
        {out(['db.owns', 'db.write', 'db.read', 'cache.read', 'cache.write']).length ? (
          <PartyGrid
            rows={out(['db.owns', 'db.write', 'db.read', 'cache.read', 'cache.write'])}
            detail={detail}
            side="to"
            storageKey="svc-stores"
          />
        ) : (
          <Empty title="No database or cache" />
        )}
      </Card>

      <Card title="Exposes">
        {out(['http.expose']).length ? (
          <PartyGrid rows={out(['http.expose'])} detail={detail} side="to" storageKey="svc-exposes" />
        ) : (
          <Empty title="Serves no HTTP endpoint" />
        )}
      </Card>

      {detail.bindings.length > 0 && (
        <Card title="Contracts" sub="What this service binds, and at which version">
          <BindingGrid bindings={detail.bindings} storageKey="svc-bindings" by="contract" />
        </Card>
      )}
    </>
  )
}

function ContractBody({ detail }: { detail: NodeDetail }) {
  const versions = new Set(detail.bindings.map((b) => b.version))
  const topics = detail.viaContract.filter((e) => e.kind === 'topic.schema')

  return (
    <>
      <Card
        title={`Bound by ${detail.bindings.length} service${detail.bindings.length === 1 ? '' : 's'}`}
        sub={
          versions.size > 1
            ? `${versions.size} different versions are in use — the lowest is the one that constrains a change`
            : 'Every service is on the same version'
        }
      >
        {detail.bindings.length ? (
          <BindingGrid bindings={detail.bindings} storageKey="contract-bindings" skew={versions.size > 1} />
        ) : (
          <Empty title="Nothing binds this contract" />
        )}
      </Card>

      <Card title="Carried by" sub="The topics and calls this payload travels on">
        {topics.length || detail.viaContract.length ? (
          <DataGrid
            rows={detail.viaContract}
            rowKey={(e) => e.id}
            storageKey="contract-carriers"
            columns={[
              { key: 'to', label: 'Carrier', value: (e) => idValue(e.to), render: (e) => <Link to={nodeHref(e.to)}>{idValue(e.to)}</Link> },
              { key: 'kind', label: 'Via', value: (e) => EDGE_LABEL[e.kind] ?? e.kind },
              { key: 'from', label: 'Declared by', value: (e) => idValue(e.from), render: (e) => <Link to={nodeHref(e.from)}>{idValue(e.from)}</Link> },
            ]}
          />
        ) : (
          <Empty title="No topic declares this contract" />
        )}
      </Card>
    </>
  )
}

function StoreBody({ detail }: { detail: NodeDetail }) {
  const group = (kinds: string[]) => detail.in.filter((e) => kinds.includes(e.kind))
  const owners = group(['db.owns'])
  const writers = group(['db.write', 'cache.write'])
  const readers = group(['db.read', 'cache.read'])

  return (
    <>
      <Card title={`Owner${owners.length === 1 ? '' : 's'}`} sub="Whoever holds the migrations">
        {owners.length ? (
          <PartyGrid rows={owners} detail={detail} side="from" storageKey="store-owners" />
        ) : (
          <Empty title="No repository claims this store">
            <span className="muted" style={{ fontSize: 12 }}>
              Nothing in the scanned set holds its migrations.
            </span>
          </Empty>
        )}
      </Card>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Side
          title="Writers"
          rows={writers}
          detail={detail}
          side="from"
          storageKey="store-writers"
          empty="Nothing writes here"
        />
        <Side
          title="Readers"
          rows={readers}
          detail={detail}
          side="from"
          storageKey="store-readers"
          empty="Nothing reads here"
        />
      </div>
    </>
  )
}

function EndpointBody({ detail }: { detail: NodeDetail }) {
  const exposed = detail.in.filter((e) => e.kind === 'http.expose')
  const callers = detail.in.filter((e) => e.kind === 'http.call')

  return (
    <>
      <Card title="Served by">
        {exposed.length ? (
          <PartyGrid rows={exposed} detail={detail} side="from" storageKey="endpoint-server" />
        ) : (
          <Empty title="No scanned repository serves this route">
            <span className="muted" style={{ fontSize: 12 }}>
              Somebody is calling it, so either it lives outside the scanned set or the callers are
              pointing at nothing.
            </span>
          </Empty>
        )}
      </Card>
      <Card title={`Callers (${callers.length})`}>
        {callers.length ? (
          <PartyGrid rows={callers} detail={detail} side="from" storageKey="endpoint-callers" />
        ) : (
          <Empty title="Nothing in the scanned set calls this endpoint" />
        )}
      </Card>
    </>
  )
}

function ExternalBody({ detail }: { detail: NodeDetail }) {
  return (
    <Card title={`Callers (${detail.in.length})`} sub="Who in the estate depends on this third party">
      {detail.in.length ? (
        <PartyGrid rows={detail.in} detail={detail} side="from" storageKey="external-callers" />
      ) : (
        <Empty title="Nothing calls this" />
      )}
    </Card>
  )
}

/* ---------------------------------------------------------------- pieces */

function Side({
  title,
  rows,
  detail,
  side,
  storageKey,
  empty = 'Nothing here',
}: {
  title: string
  rows: GraphEdge[]
  detail: NodeDetail
  side: 'from' | 'to'
  storageKey: string
  empty?: string
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Card title={`${title} (${rows.length})`}>
        {rows.length ? (
          <PartyGrid rows={rows} detail={detail} side={side} storageKey={storageKey} />
        ) : (
          <Empty title={empty} />
        )}
      </Card>
    </div>
  )
}

/**
 * The other end of a set of edges, with what it is for and the citation that
 * proves it. Every row on every one of these pages is one of these.
 */
function PartyGrid({
  rows,
  detail,
  side,
  storageKey,
}: {
  rows: GraphEdge[]
  detail: NodeDetail
  side: 'from' | 'to'
  storageKey: string
}) {
  const named = useMemo(
    () => new Map(detail.neighbours.map((n) => [n.id, n] as const)),
    [detail.neighbours]
  )
  const other = (e: GraphEdge) => (side === 'to' ? e.to : e.from)
  const label = (e: GraphEdge) => named.get(other(e))?.name ?? idValue(other(e))

  // When every row is the same relationship the card title already said so,
  // and the column is a stripe of repeated text in a narrow card.
  const mixed = new Set(rows.map((e) => e.kind)).size > 1

  const columns: GridColumn<GraphEdge>[] = [
    {
      key: 'party',
      label: side === 'to' ? 'Target' : 'Source',
      value: label,
      render: (e) => <Link to={nodeHref(other(e))}>{label(e)}</Link>,
    },
    ...(mixed
      ? [{ key: 'kind', label: 'Relationship', value: (e: GraphEdge) => EDGE_LABEL[e.kind] ?? e.kind }]
      : []),
    { key: 'description', label: 'What it is for', wide: true, value: (e) => e.description ?? '' },
    {
      key: 'evidence',
      label: 'Evidence',
      value: (e) => citation(detail.edgeEvidence[e.id])?.file ?? '',
      render: (e) => <Citation evidence={detail.edgeEvidence[e.id]} />,
    },
    { key: 'confidence', label: 'Confidence', value: (e) => e.confidence },
  ]

  return <DataGrid rows={rows} rowKey={(e) => e.id} columns={columns} storageKey={storageKey} />
}

const citation = (evidence?: Evidence[]) => evidence?.[0]

/**
 * Enough of the path to recognise the file, in a column narrow enough to sit
 * beside three others. The whole citation and the line itself are on the title,
 * and the node's own evidence list below carries all of them in full.
 */
function Citation({ evidence }: { evidence?: Evidence[] }) {
  const first = citation(evidence)
  if (!first) return <span className="muted">—</span>
  const more = (evidence?.length ?? 0) - 1
  const parts = first.file.split('/')
  const short = parts.slice(-2).join('/')
  return (
    <code
      className="muted"
      title={`${first.repo} · ${first.file}:${first.line}\n${first.snippet}`}
      style={{ fontSize: 11 }}
    >
      {parts.length > 2 ? '…/' : ''}
      {short}:{first.line}
      {more > 0 ? ` +${more}` : ''}
    </code>
  )
}

function BindingGrid({
  bindings,
  storageKey,
  by = 'service',
  skew,
}: {
  bindings: NodeDetail['bindings']
  storageKey: string
  by?: 'service' | 'contract'
  skew?: boolean
}) {
  // Sorted by version so a divergence is one glance, not a hunt down a column.
  // `numeric` because a plain lexical compare puts 3.10.0 below 3.9.0, and the
  // first row is painted as the version that constrains a change — getting it
  // backwards points the reader at the wrong service. This is the same
  // ordering trap SPEC-PROCESSES §3 spells out for process codes, and it is
  // what DataGrid's own comparator already does when you click the header.
  const rows = [...bindings].sort(
    (a, b) =>
      String(a.version).localeCompare(String(b.version), undefined, { numeric: true }) ||
      a.service_id.localeCompare(b.service_id)
  )
  const lowest = rows[0]?.version

  return (
    <DataGrid
      rows={rows}
      rowKey={(b) => `${b.contract_id}|${b.service_id}`}
      storageKey={storageKey}
      columns={[
        by === 'contract'
          ? {
              key: 'contract',
              label: 'Contract',
              value: (b) => idValue(b.contract_id),
              render: (b) => <Link to={nodeHref(b.contract_id)}>{idValue(b.contract_id)}</Link>,
            }
          : {
              key: 'service',
              label: 'Service',
              value: (b) => idValue(b.service_id),
              render: (b) => <Link to={nodeHref(b.service_id)}>{idValue(b.service_id)}</Link>,
            },
        {
          key: 'version',
          label: 'Version',
          value: (b) => b.version ?? '',
          render: (b) => (
            <span style={skew && b.version === lowest ? { color: 'var(--status-critical)' } : undefined}>
              {b.version ?? '—'}
            </span>
          ),
        },
      ]}
    />
  )
}
