import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Process, type ProcessComponent, type ProcessDetail, type ProcessSource, type TeamReach, type Handoff } from '../lib/api'
import { Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'
import { relative } from '../lib/format'
import { driftTitle } from '../lib/drift'
import { HandoffList } from '../components/HandoffList'
import { Mermaid } from '../graph/ProcessFlow'
import {
  DIAGRAM_LABEL,
  DIAGRAM_SUB,
  available,
  flowDiagram,
  handoffDiagram,
  laneDiagram,
  sequenceDiagram,
  treeDiagram,
  type DiagramKind,
} from '../graph/processDiagrams'
import { MapCanvas } from '../graph/MapCanvas'
import {
  KIND_PLURAL,
  VIA_LABEL,
  displayCode,
  flowDirection,
  flowVerb,
  idValue,
  nodeHref,
  processHref,
  teamHref,
} from '../lib/nodes'
import type { NodeKind } from '../lib/api'

/**
 * One process, at whatever level it sits. The children ARE the flow — the
 * levels are decomposition, so a level 2's children read top to bottom as what
 * happens, and a level 3 has none and is itself the content.
 *
 * A code is `2.1.1`, full of dots, so it travels as a query parameter and
 * never as a path segment.
 */
export function ProcessPage() {
  const [params] = useSearchParams()
  const code = params.get('code') ?? ''
  const [data, setData] = useState<ProcessDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    if (!code) return
    api
      .get<ProcessDetail>('/process', { code })
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(String((err as Error).message)))
    return () => {
      cancelled = true
    }
  }, [code])

  if (!code) return <div className="page"><Empty title="No process selected" /></div>
  if (error)
    return (
      <div className="page">
        <Empty title={error}>
          <code>{code}</code>
          <p className="muted" style={{ fontSize: 13 }}>
            <Link to="/processes">Back to the process tree →</Link>
          </p>
        </Empty>
      </div>
    )
  if (!data) return null

  const { process, ancestors, children, components, services, links, teams, drift, pack } = data
  const byKind = new Map<string, ProcessComponent[]>()
  for (const c of components) {
    if (!byKind.has(c.kind)) byKind.set(c.kind, [])
    byKind.get(c.kind)!.push(c)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="proc-crumbs">
            <Link to="/processes">Processes</Link>
            {ancestors.map((a) => (
              <span key={a.id}>
                {' › '}
                <Link to={processHref(a.code)}>
                  {displayCode(a.code)} {a.name}
                </Link>
              </span>
            ))}
          </p>
          <h1>
            <span className="proc-code-head">{displayCode(process.code)}</span> {process.name}
          </h1>
          <p>
            <span className="pill">Level {process.level}</span>{' '}
            {process.owner ? <>owned by {process.owner}</> : 'no owner recorded'}
            {process.actor ? <> · performed by {process.actor}</> : null}
            {process.optional ? <> · only in some cases</> : null}
            {pack ? (
              <>
                {' '}
                · from <code>{pack.pack}</code>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {process.description && <p className="proc-lede">{process.description}</p>}

      {/* Known issues, planned changes, why it is done this odd way. Quieter
          than the description because it is an aside, but it is often the
          sentence somebody needed. */}
      {process.notes && (
        <p className="proc-notes">
          <span className="nav-group-label">Note</span> {process.notes}
        </p>
      )}

      {(process.trigger || process.outcome) && (
        <div className="row proc-bookends">
          {process.trigger && (
            <div>
              <span className="nav-group-label">Starts when</span>
              <p>{process.trigger}</p>
            </div>
          )}
          {process.outcome && (
            <div>
              <span className="nav-group-label">Ends with</span>
              <p>{process.outcome}</p>
            </div>
          )}
        </div>
      )}

      {children.length > 0 ? (
        <Flow detail={data} />
      ) : (
        <Card title="What happens here" sub="This is a leaf — the atomic unit of work">
          <Binding process={process} />
        </Card>
      )}

      {children.length > 0 && (process.node || process.edge) && (
        <Card title="This process's own component" sub="Unusual above level 3, but not an error">
          <Binding process={process} />
        </Card>
      )}

      <Card
        title={`Components used (${components.length})`}
        sub="Rolled up from everything underneath this process"
      >
        {components.length ? (
          <div className="stack" style={{ gap: 12 }}>
            {[...byKind].map(([kind, list]) => (
              <div key={kind}>
                <span className="nav-group-label">{KIND_PLURAL[kind as NodeKind] ?? kind}</span>
                <ul className="proc-components">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link to={nodeHref(c.id)}>{c.name}</Link>
                      <span className="muted"> · {VIA_LABEL[c.via] ?? c.via}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Nothing in the map is bound to this process yet" />
        )}
      </Card>

      <Card
        title="On the map"
        sub="This process's components and the relationships among them — the shape the sequence diagram cannot show"
      >
        <MapCanvas height={420} focus="" depth="all" process={process.code} storageKey={`p.${process.code}`} />
      </Card>

      <TeamsCard process={process} teams={teams} />

      <HandoffsCard process={process} links={links} />

      <Card
        title={`Services involved (${services.length})`}
        sub={
          services.length
            ? /* Counted on the resolved id, because this is a number rather
                 than a label: two services whose manifests spell one team two
                 ways were two teams here until they were counted on what the
                 registry says they are. */
              (() => {
                const teams = new Set(services.map((s) => s.teamId).filter(Boolean)).size
                return `${teams} team${teams === 1 ? '' : 's'} across the whole subtree`
              })()
            : undefined
        }
      >
        {services.length ? (
          <DataGrid
            rows={services}
            rowKey={(s) => s.id}
            storageKey="process-services"
            columns={[
              {
                key: 'name',
                label: 'Service',
                value: (s) => s.name,
                render: (s) => <Link to={nodeHref(s.id)}>{s.name}</Link>,
              },
              {
                key: 'team',
                label: 'Team',
                // The resolved team, not the raw string: an endpoint's comes
                // from its exposer and a topic's from its producer, and the
                // raw column is empty for everything but a service.
                value: (s) => s.teamName ?? s.teamId ?? s.team ?? '',
                render: (s) =>
                  s.teamId ? (
                    <Link to={teamHref(s.teamId)}>{s.teamName ?? s.teamId}</Link>
                  ) : (
                    <span className="muted">—</span>
                  ),
              },
              { key: 'repo', label: 'Repository', value: (s) => s.ownerRepo ?? '' },
              { key: 'via', label: 'Reached', value: (s) => VIA_LABEL[s.via] ?? s.via },
            ]}
          />
        ) : (
          <Empty title="No service resolved for this process" />
        )}
      </Card>

      {drift.length > 0 && (
        <Card title={`Findings (${drift.length})`} sub="Where this document and the code disagree">
          <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
            {drift.map((f) => (
              <li key={f.id}>
                <strong>{driftTitle(f.kind)}</strong> — {f.detail}
                {f.state === 'accepted' && <span className="muted"> · accepted</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(pack?.source || process.source) && <Source source={process.source ?? pack?.source ?? null} pack={pack} />}
    </div>
  )
}

const KINDS: DiagramKind[] = ['sequence', 'flow', 'lanes', 'handoffs', 'tree']
const DIAGRAM_KEY = 'architecture-map.process-diagram'

/**
 * The decomposition, as a list or as one of five diagrams. Every one of them
 * is the same data read the same way — the children in order — because the
 * numbering is the order and there is no separate sequence anywhere. What
 * differs is the question each answers.
 *
 * One card and one control rather than a card per diagram: the same rows drawn
 * five ways are one thing on the page, not five.
 */
function Flow({ detail }: { detail: ProcessDetail }) {
  const { process, children, descendants, components, links } = detail
  const [view, setView] = useState<'list' | 'diagram'>('list')
  const [kind, setKind] = useState<DiagramKind>(() => {
    const saved = localStorage.getItem(DIAGRAM_KEY)
    return KINDS.includes(saved as DiagramKind) ? (saved as DiagramKind) : 'sequence'
  })
  const nameOf = (id: string) => components.find((c) => c.id === id)?.name ?? idValue(id)
  const title = `${displayCode(process.code)} ${process.name}`

  // A tab with nothing behind it is worse than a missing tab: it teaches the
  // reader that the diagrams are unreliable. A level 3 decomposes into nothing
  // and a process that hands off to nobody has no handoff picture.
  const offered = KINDS.filter((k) => available(k, detail, nameOf))
  const shown = offered.includes(kind) ? kind : offered[0]

  const lanes = useMemo(() => laneDiagram(process, children, nameOf), [process, children, components])
  const source = useMemo(() => {
    switch (shown) {
      case 'flow':
        return flowDiagram(process, children)
      case 'lanes':
        return lanes.source
      case 'handoffs':
        return handoffDiagram(process, links)
      case 'tree':
        return treeDiagram(process, descendants)
      default:
        return sequenceDiagram(children, nameOf, title)
    }
    // `nameOf` closes over components, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, process, children, descendants, components, links, lanes, title])

  return (
    <Card
      title={`What happens, in order (${children.length})`}
      sub={
        view === 'diagram' && shown
          ? DIAGRAM_SUB[shown]
          : 'Each of these says the same thing in more detail. The numbering is the order.'
      }
      actions={
        children.length > 0 ? (
          <div className="row" style={{ gap: 8 }}>
            {view === 'diagram' && offered.length > 1 && (
              <select
                aria-label="Diagram"
                value={shown}
                onChange={(e) => {
                  const next = e.target.value as DiagramKind
                  setKind(next)
                  try {
                    localStorage.setItem(DIAGRAM_KEY, next)
                  } catch {
                    /* a private window is not a reason to fail */
                  }
                }}
              >
                {offered.map((k) => (
                  <option key={k} value={k}>
                    {DIAGRAM_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
            <div className="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                List
              </button>
              <button
                type="button"
                aria-pressed={view === 'diagram'}
                onClick={() => setView('diagram')}
              >
                Diagram
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      {view === 'diagram' && shown ? (
        <div className="stack" style={{ gap: 8 }}>
          <Mermaid source={source} label={`${DIAGRAM_LABEL[shown]} diagram of ${title}`} />
          {shown === 'lanes' && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {lanes.by === 'team'
                ? 'One lane per team. Every arrow that leaves a lane is work crossing a boundary.'
                : 'One team does all of this, so the lanes are the components instead — a diagram with one lane says nothing.'}
            </p>
          )}
        </div>
      ) : (
        <ol className="proc-flow">
          {children.map((c) => (
            <Step key={c.id} process={c} />
          ))}
        </ol>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ parts */

/** One child, as a numbered line of the flow. */
function Step({ process }: { process: Process }) {
  return (
    <li className="proc-step">
      <div className="proc-step-head">
        <Link to={processHref(process.code)} className="proc-code">
          {displayCode(process.code)}
        </Link>
        <Link to={processHref(process.code)} className="proc-step-name">
          {process.name}
        </Link>
        {process.optional && <span className="pill">optional</span>}
        {process.childCount > 0 && (
          <span className="muted proc-count">{process.childCount} parts</span>
        )}
      </div>
      {process.description && <p className="proc-step-desc">{process.description}</p>}
      {process.notes && (
        <p className="proc-step-desc proc-notes">
          <span className="nav-group-label">Note</span> {process.notes}
        </p>
      )}
      <Binding process={process} compact />
    </li>
  )
}

/**
 * Who is accountable, and which other teams this process reaches. At level 1
 * this is the answer to "how many teams does this cross", which used to have to
 * be counted by eye off the services list.
 */
function TeamsCard({ process, teams }: { process: Process; teams: TeamReach[] }) {
  const owner = teams.find((t) => t.via === 'owner')
  const others = new Map<string, TeamReach[]>()
  for (const t of teams) {
    if (t.via === 'owner') continue
    if (!others.has(t.id)) others.set(t.id, [])
    others.get(t.id)!.push(t)
  }

  return (
    <Card
      title="Teams"
      sub={
        others.size
          ? `Owned by one team and reaching ${others.size} other${others.size === 1 ? '' : 's'}`
          : 'Everything this process touches belongs to its own team'
      }
    >
      <ul className="team-reach">
        <li>
          {owner ? (
            <>
              <Link to={teamHref(owner.id)} className="pill good">
                {owner.name ?? owner.id}
              </Link>
              <span className="via">
                accountable{process.teamVia === 'inherited' ? ', inherited from the process above' : ''}
              </span>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 13 }}>
              Nobody is named as the owner of this process.
            </span>
          )}
        </li>
        {[...others].map(([id, rows]) => {
          const viaComponent = rows.filter((r) => r.via === 'component')
          const viaHandoff = rows.some((r) => r.via === 'handoff')
          return (
            <li key={id}>
              <Link to={teamHref(id)} className="pill">
                {rows[0].name ?? id}
              </Link>
              <span className="via">
                {viaHandoff && 'hands off'}
                {viaHandoff && viaComponent.length > 0 && ', and '}
                {viaComponent.length > 0 && (
                  <>
                    through{' '}
                    {viaComponent.slice(0, 3).map((r, i) => (
                      <span key={r.viaNode}>
                        {i > 0 && ', '}
                        <Link to={nodeHref(r.viaNode)}>{idValue(r.viaNode)}</Link>
                      </span>
                    ))}
                    {viaComponent.length > 3 && ` and ${viaComponent.length - 3} more`}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * One handoff exists at every level of both its ends, because the rollup says
 * so — `1.3.2 → 2.4.2` is also `1 → 2.4` and `1 → 2`. Showing all of them
 * restates one fact three times, which on a level 1 read as three separate
 * broken handoffs.
 *
 * So: one row per counterpart, at the altitude the reader is at. A level 1
 * hands off to `L2 Order and execution`; a leaf hands off to the leaf that
 * picks it up. Ties go to the more specific, because that is the one that
 * names what actually happens.
 */
function atMyLevel(handoffs: Handoff[], level: number, far: 'to' | 'from'): Handoff[] {
  const best = new Map<string, Handoff>()
  for (const h of handoffs) {
    const code = h[far].code
    // Keyed on the carrier as well as the counterpart: one pair genuinely
    // handing off over two topics is two facts, and collapsing them would hide
    // one. It is only the SAME handoff restated at three levels that folds.
    const root = `${code.split('.')[0]}|${h.viaNode ?? ''}`
    const mine = best.get(root)
    if (!mine) {
      best.set(root, h)
      continue
    }
    const score = (c: string) => {
      const l = c.split('.').length
      return [Math.abs(l - level), -l]
    }
    const a = score(code)
    const b = score(mine[far].code)
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) best.set(root, h)
  }
  return [...best.values()]
}

/**
 * Three lists, not two. `inside` is the handoffs whose BOTH ends are beneath
 * this process: the rollup deliberately skips a pair where one end contains the
 * other, so without it a level 1 that crosses four teams shows none of them.
 */
function HandoffsCard({ process, links }: { process: Process; links: ProcessDetail['links'] }) {
  const out = atMyLevel(links.out, process.level, 'to')
  const into = atMyLevel(links.in, process.level, 'from')
  const total = out.length + into.length + links.inside.length
  if (!total) return null
  return (
    <Card
      title={`Handoffs (${total})`}
      sub="Where this process ends and another begins. Derived from the events the code publishes; declared where the code cannot show it"
    >
      <div className="stack" style={{ gap: 14 }}>
        <HandoffList title="Hands off to" handoffs={out} side="to" />
        <HandoffList title="Picked up from" handoffs={into} side="from" />
        <HandoffList title="Inside this process" handoffs={links.inside} side="both" />
      </div>
    </Card>
  )
}

/**
 * Where a process happens and what it travels over. An unresolved reference is
 * stated plainly rather than dropped — its whole value is that it is visible.
 */
function Binding({ process, compact }: { process: Process; compact?: boolean }) {
  if (!process.node && !process.edge) {
    return compact ? null : (
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        This process names no component. Its parts carry the detail.
      </p>
    )
  }

  return (
    <div className={`proc-binding${compact ? ' compact' : ''}`}>
      {process.node && (
        <span className="proc-bind-part">
          <span className="muted">at</span>{' '}
          {process.unresolved.node ? (
            <Unresolved id={process.node} />
          ) : (
            <Link to={nodeHref(process.node)}>{idValue(process.node)}</Link>
          )}
        </span>
      )}
      {process.edge && <Interaction edge={process.edge} unresolved={process.unresolved} />}
    </div>
  )
}

/**
 * Drawn in the direction data flows, through the one helper that is allowed to
 * reverse an edge — a consume reads topic → service even though it is stored
 * service → topic.
 */
function Interaction({
  edge,
  unresolved,
}: {
  edge: { from: string; kind: string; to: string }
  unresolved: Process['unresolved']
}) {
  const { source, target } = flowDirection(edge as Parameters<typeof flowDirection>[0])
  const verb = flowVerb(edge.kind as Parameters<typeof flowVerb>[0])
  // Each end answers for itself. An interaction can be missing while both its
  // ends are one click away — that is the finding — so a component is only
  // struck through when the map genuinely does not have it. flowDirection may
  // swap the ends, so the flags travel with the ids rather than the words.
  const absent = (id: string) => (id === edge.from ? unresolved.edgeFrom : unresolved.edgeTo)
  const end = (id: string) =>
    absent(id) ? <Unresolved id={id} /> : <Link to={nodeHref(id)}>{idValue(id)}</Link>

  return (
    <span className="proc-bind-part">
      {end(source)}
      <span className="proc-arrow" aria-label={verb}>
        {' '}
        — {verb} →{' '}
      </span>
      {end(target)}
      {unresolved.edge && !absent(source) && !absent(target) && (
        <span className="proc-missing-note" title="Both ends exist; this relationship is not in the code">
          not in the map
        </span>
      )}
    </span>
  )
}

function Unresolved({ id }: { id: string }) {
  return (
    <span className="proc-missing" title="No such component in the map">
      {idValue(id)}
    </span>
  )
}

/**
 * Process facts are asserted by people, not derived from code, so they carry
 * attribution rather than a file and a line. A process nobody has confirmed in
 * a year should look like it, which is what the age is for.
 */
function Source({ source, pack }: { source: ProcessSource | null; pack: ProcessDetail['pack'] }) {
  if (!source) return null
  const asOf = source.asOf ? Date.parse(`${source.asOf}T00:00:00Z`) : NaN
  const stale = Number.isFinite(asOf) && Date.now() - asOf > 365 * 24 * 3600 * 1000

  return (
    <Card title="Where this came from" sub="Asserted by a person — there is no file and line behind it">
      <dl className="proc-source">
        {source.title && (
          <>
            <dt>Document</dt>
            <dd>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              ) : (
                source.title
              )}
              {source.kind ? <span className="muted"> · {source.kind}</span> : null}
            </dd>
          </>
        )}
        {source.owner && (
          <>
            <dt>Confirmed by</dt>
            <dd>{source.owner}</dd>
          </>
        )}
        {source.asOf && (
          <>
            <dt>Last confirmed</dt>
            <dd>
              {source.asOf}
              {Number.isFinite(asOf) && (
                <span className={stale ? 'proc-stale' : 'muted'}> · {relative(asOf)}</span>
              )}
              {stale && <span className="pill"> nobody has checked this in a year</span>}
            </dd>
          </>
        )}
        {pack && (
          <>
            <dt>Pack</dt>
            <dd>
              <code>{pack.pack}</code>
              {pack.name ? ` · ${pack.name}` : ''}
            </dd>
          </>
        )}
      </dl>
    </Card>
  )
}
