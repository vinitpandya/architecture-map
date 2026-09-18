import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Process, type ProcessComponent, type ProcessDetail, type ProcessSource } from '../lib/api'
import { Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'
import { relative } from '../lib/format'
import { ProcessFlow } from '../graph/ProcessFlow'
import {
  KIND_PLURAL,
  VIA_LABEL,
  displayCode,
  flowDirection,
  flowVerb,
  idValue,
  nodeHref,
  processHref,
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

  const { process, ancestors, children, components, services, drift, pack } = data
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
        <Flow process={process} children={children} components={components} />
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
        title={`Services involved (${services.length})`}
        sub={
          services.length
            ? `${new Set(services.map((s) => s.team).filter(Boolean)).size} team${
                new Set(services.map((s) => s.team).filter(Boolean)).size === 1 ? '' : 's'
              } across the whole subtree`
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
              { key: 'team', label: 'Team', value: (s) => s.team ?? '' },
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
                <strong>{f.kind}</strong> — {f.detail}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(pack?.source || process.source) && <Source source={process.source ?? pack?.source ?? null} pack={pack} />}
    </div>
  )
}

/**
 * The decomposition, as a list or as a diagram. Both are the same data read
 * the same way — the children in order — because the numbering is the order
 * and there is no separate sequence anywhere.
 */
function Flow({
  process,
  children,
  components,
}: {
  process: Process
  children: Process[]
  components: ProcessComponent[]
}) {
  const [view, setView] = useState<'list' | 'diagram'>('list')
  const nameOf = (id: string) => components.find((c) => c.id === id)?.name ?? idValue(id)
  // Every process with children has a diagram, per §8: "because the children
  // are the flow, this works at every level — L2 draws four boxes, L2.1 draws
  // its four actions". A level 1's stages carry no interaction of their own,
  // which is the `Note over` case, not a reason to withhold the view.
  const drawable = children.length > 0

  return (
    <Card
      title={`What happens, in order (${children.length})`}
      sub="Each of these says the same thing in more detail. The numbering is the order."
      actions={
        drawable ? (
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
            <button type="button" aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>
              Diagram
            </button>
          </div>
        ) : undefined
      }
    >
      {view === 'diagram' && drawable ? (
        <ProcessFlow children={children} nameOf={nameOf} title={`${displayCode(process.code)} ${process.name}`} />
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
