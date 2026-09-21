import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  api,
  type Evidence,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type NodeDetail,
  type NodeKind,
} from '../lib/api'
import { useQuery, useScope } from '../lib/scope'
import { Empty, Legend, useThemeVersion } from '../components/ui'
import {
  EDGE_LABEL,
  KIND_COLOR,
  KIND_LABEL,
  KIND_PLURAL,
  NO_TEAM_COLOR,
  edgeStyle,
  flowDirection,
  idValue,
  nodeHref,
  teamColours,
} from '../lib/nodes'
import { layoutGraph, layoutKey, nodeSize, type Position } from './layout'
import { nodeTypes, type MapNodeData } from './nodeTypes'
import {
  RELATIONS,
  RELATION_COLOR,
  RELATION_LABEL,
  RELATION_STYLE,
  collapseToServices,
  isDerived,
  type Relation,
  type ServiceEdge,
} from './collapse'

/** Above this, labels go away below 0.5 zoom — §11. */
const LABEL_BUDGET = 150
const INSPECTOR_KEY = 'architecture-map.inspector'
const COLOUR_KEY = 'architecture-map.colour-by'
const LEGEND_KEY = 'architecture-map.legend'
const DETAIL_KEY = 'architecture-map.detail.'
const LAYOUT_KEY = 'architecture-map.layout.'

/**
 * How much of the estate a map draws. `services` collapses every topic, store
 * and endpoint into the line it carries; `all` is the scan as it was stored.
 */
export type Detail = 'services' | 'all'

/** localStorage is absent in a private window and full on a shared one.
 *  Neither is a reason for the map to fail to draw. */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* nothing here is worth failing a render over */
  }
}
/** Hand-placed nodes are per map and per detail level: the two levels do not
 *  share a node set, so they cannot share an arrangement. */
const layoutSlot = (storageKey: string, detail: Detail) => `${LAYOUT_KEY}${storageKey}.${detail}`

/** The key's row for everything the registry does not name an owner for. */
const TEAMLESS = '·none'

export function MapCanvas({
  height,
  focus,
  depth,
  pinned = false,
  process,
  storageKey = 'map',
}: {
  height: number
  focus: string
  depth: string
  /** A map fixed to one node by its widget options ignores the filter row. */
  pinned?: boolean
  /**
   * Restrict to one process's components, ignoring the filter row entirely.
   * The process page has no filter row, and must not inherit whatever the map
   * page was last set to — so every scope parameter is overridden, not just
   * `process`.
   */
  process?: string
  /**
   * Which map this is, for the arrangement and detail level saved against it.
   * Two maps on one page are two maps: dragging a node on one must not move it
   * on the other.
   */
  storageKey?: string
}) {
  const { data, loading } = useQuery<GraphData>(
    '/graph',
    process
      ? { process, focus: '', depth: 'all', kinds: '', repos: '', teams: '', includeExternal: 'true' }
      : { focus, depth }
  )
  const { setScope, status } = useScope()
  const [params, setParams] = useSearchParams()
  const theme = useThemeVersion()

  const [positions, setPositions] = useState<Record<string, Position> | null>(null)
  const [laidOut, setLaidOut] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [zoomedOut, setZoomedOut] = useState(false)
  const [open, setOpen] = useState(() => localStorage.getItem(INSPECTOR_KEY) !== 'closed')
  /**
   * Node kind already owns six of theme.css's eight categorical slots and that
   * file is off limits, so there is no second palette: a team cannot simply be
   * another colour. One encoding wins at a time, and this is what decides.
   */
  const [colourBy, setColourBy] = useState<'kind' | 'team'>(
    () => (localStorage.getItem(COLOUR_KEY) === 'team' ? 'team' : 'kind')
  )
  const [legendOpen, setLegendOpen] = useState(() => localStorage.getItem(LEGEND_KEY) !== 'closed')
  /**
   * A process map is already narrow, and its components *are* the topics and
   * stores — collapsing them would leave a diagram of two services. So the
   * estate opens at service level and a process map opens at full detail;
   * either can be changed, and the choice is remembered per map.
   */
  const [detail, setDetail] = useState<Detail>(() =>
    read<Detail>(DETAIL_KEY + storageKey, process ? 'all' : 'services')
  )
  /**
   * What the key is currently switched off. Kept per encoding rather than in
   * one set, so whatever is hidden is always something the legend in front of
   * you can switch back on.
   */
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set())
  const [hiddenTeams, setHiddenTeams] = useState<Set<string>>(new Set())
  const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(new Set())
  /** Hand-placed nodes, overlaid on the computed layout. */
  const [placedByHand, setPlacedByHand] = useState<Record<string, Position>>({})
  /** The derived line whose intermediaries are on screen. */
  const [through, setThrough] = useState<ServiceEdge | null>(null)

  const flow = useRef<ReactFlowInstance | null>(null)
  const urlFocus = useRef<string | null>(null)

  const all = data?.nodes ?? []
  const teamSlot = useMemo(() => teamColours(all.map((n) => n.teamId)), [all])

  // What is actually drawn: the collapse, then whatever the key has switched
  // off. Hiding a kind removes its nodes and every line that ran through one.
  const view = useMemo(() => {
    const empty: GraphNode[] = []
    const noEdges: GraphEdge[] = []
    if (!data) return { nodes: empty, edges: noEdges, candidates: empty, candidateEdges: noEdges }
    const base: GraphData = detail === 'services' ? collapseToServices(data) : data
    const gone = (n: GraphNode) =>
      colourBy === 'team' ? hiddenTeams.has(n.teamId ?? TEAMLESS) : hiddenKinds.has(n.kind)
    const nodes = base.nodes.filter((n) => !gone(n))
    const live = new Set(nodes.map((n) => n.id))
    const edges = base.edges.filter(
      (e) =>
        live.has(e.from) &&
        live.has(e.to) &&
        !(isDerived(e) && e.through.length > 0 && hiddenRelations.has(e.relation))
    )
    // The key is drawn from what this detail level *could* show, not from
    // what survived the toggles: a row that vanishes when you switch it off
    // leaves no way to switch it back on.
    return { nodes, edges, candidates: base.nodes, candidateEdges: base.edges }
  }, [data, detail, colourBy, hiddenKinds, hiddenTeams, hiddenRelations])

  const nodes = view.nodes
  const edges = view.edges
  const key = useMemo(() => layoutKey(nodes, edges), [nodes, edges])

  // Detail level and map identity each pick a different saved arrangement.
  useEffect(() => {
    setPlacedByHand(read<Record<string, Position>>(layoutSlot(storageKey, detail), {}))
    setThrough(null)
  }, [storageKey, detail])

  // A selection the graph no longer contains has no neighbours, so every node
  // on the map counts as un-adjacent and the whole canvas dims with nothing
  // showing a selection ring to explain it — while the inspector goes on
  // describing a node that is not there.
  useEffect(() => {
    if (selected && data && !nodes.some((n) => n.id === selected)) setSelected(null)
    // `nodes` is a fresh array each render; its ids are what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selected, !!data])

  /* ------------------------------------------------------------- layout */

  // Keyed on the id sets, not on every render: the same graph must not be laid
  // out twice, or nodes move for no reason the reader can see.
  useEffect(() => {
    if (!data) return
    if (!nodes.length) {
      setPositions({})
      setLaidOut(key)
      return
    }
    let cancelled = false
    layoutGraph(nodes, edges).then((next) => {
      if (cancelled) return
      setPositions(next)
      setLaidOut(key)
      requestAnimationFrame(() => flow.current?.fitView({ padding: 0.14, duration: 0 }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!data])

  /* -------------------------------------------------------- url ↔ filter */

  // The browser back button has to undo a re-focus, so focus and depth live in
  // the query string and the filter row follows them.
  useEffect(() => {
    if (pinned || process) return
    const fromUrl = params.get('focus')
    if (fromUrl === urlFocus.current) return
    urlFocus.current = fromUrl
    setScope({ focus: fromUrl ?? '', depth: params.get('depth') ?? '1' })
  }, [params, pinned, process, setScope])

  const refocus = useCallback(
    (id: string) => {
      urlFocus.current = id
      setScope({ focus: id, depth: '1' })
      const next = new URLSearchParams(params)
      next.set('focus', id)
      next.set('depth', '1')
      setParams(next)
    },
    [params, setParams, setScope]
  )

  /* -------------------------------------------------------------- render */

  const token = useTokens(theme)
  const neighbours = useMemo(() => adjacency(edges, selected), [edges, selected])
  const showLabel = nodes.length <= LABEL_BUDGET || !zoomedOut

  const computed: Node[] = useMemo(() => {
    if (!positions) return []
    return nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      // A node somebody put somewhere stays there; elk only places the rest.
      position: placedByHand[n.id] ?? positions[n.id] ?? { x: 0, y: 0 },
      data: {
        node: n,
        focused: n.id === focus,
        selected: n.id === selected,
        faded: !!selected && n.id !== selected && !neighbours.has(n.id),
        showLabel,
        color: colourBy === 'team' ? (n.teamId && teamSlot.get(n.teamId)) || NO_TEAM_COLOR : undefined,
      } satisfies MapNodeData,
      ...nodeSize(n),
      // Above the edges. An edge carries an invisible 20px interaction stroke,
      // and under it a click aimed at a node lands on the edge instead.
      zIndex: 5,
      draggable: true,
      selectable: true,
      connectable: false,
    }))
    // colourBy and teamSlot are in here because the node's colour is part of
    // its data: without them the legend switched and the nodes did not.
  }, [nodes, positions, placedByHand, focus, selected, neighbours, showLabel, colourBy, teamSlot])

  /*
   * React Flow owns node positions while a drag is in flight, so the array it
   * renders has to be state it can apply changes to — a memo would snap every
   * node back to its computed position on the first mousemove. `computed` is
   * still the source: it is pushed in whenever the graph or the styling
   * changes, and a finished drag writes back to placedByHand so the two agree.
   */
  const [rfNodes, setRfNodes] = useState<Node[]>([])
  useEffect(() => setRfNodes(computed), [computed])
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes((ns) => applyNodeChanges(changes, ns)),
    []
  )
  const onNodeDragStop = useCallback(
    (_: unknown, __: Node, dragged: Node[]) => {
      setPlacedByHand((prev) => {
        const next = { ...prev }
        for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        write(layoutSlot(storageKey, detail), next)
        return next
      })
    },
    [storageKey, detail]
  )
  const resetLayout = useCallback(() => {
    setPlacedByHand({})
    write(layoutSlot(storageKey, detail), {})
    requestAnimationFrame(() => flow.current?.fitView({ padding: 0.14, duration: 240 }))
  }, [storageKey, detail])

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const { source, target } = flowDirection(e)
        // Lit by its own selection as well as by either end's, so the line the
        // Through panel is describing is the line you can see.
        const lit = through?.id === e.id || (!!selected && (e.from === selected || e.to === selected))
        // A derived line stands for something, so it is drawn in the colour of
        // what it stands for. A scanned edge stays on the axis colour: the
        // node it lands on already carries the kind.
        const stands = isDerived(e) && e.through.length > 0 ? e : null
        const stroke = lit ? token.accent : stands ? token.relations[stands.relation] : token.axis
        return {
          id: e.id,
          source,
          target,
          type: 'smoothstep',
          zIndex: lit ? 2 : 1,
          style: {
            stroke,
            strokeWidth: lit ? 1.8 : 1.1,
            strokeDasharray: DASH[stands ? RELATION_STYLE[stands.relation] : edgeStyle(e.kind)],
            cursor: stands ? 'pointer' : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 13, height: 13 },
          label: lit && showLabel ? (stands ? throughLabel(stands) : EDGE_LABEL[e.kind]) : undefined,
          labelStyle: { fill: token.text, fontSize: 10 },
          labelBgStyle: { fill: token.surface, fillOpacity: 0.92 },
          labelBgPadding: [4, 2] as [number, number],
        }
      }),
    [edges, selected, through, token, showLabel]
  )

  const derived = useMemo(
    () => new Map(edges.filter((e) => isDerived(e) && e.through.length > 0).map((e) => [e.id, e as ServiceEdge])),
    [edges]
  )
  const name = useCallback((id: string) => all.find((n) => n.id === id)?.name ?? idValue(id), [all])

  if (!data && !positions) return <div className="map-loading" style={{ height }}><span className="spinner" /></div>
  if (data && !nodes.length) {
    // An empty graph has four quite different causes and they need four
    // different sentences. Telling somebody with ten ingested manifests to run
    // the seeder, because their filter row matched nothing, is the worst of
    // them — it points at the database when the answer is on screen.
    const ingested = (status?.repos.length ?? 0) > 0
    const [title, hint] = !ingested
      ? ['Nothing ingested yet', 'Run a scan, or npm run seed:demo for the sample estate.']
      : data.nodes.length
        ? ['Everything is switched off', 'Turn a kind back on in the key.']
        : process
          ? [
              'Nothing in the map is bound to this process',
              'Its components are named by the pack, and none of them resolved.',
            ]
          : focus
            ? ['Nothing connected to that node', 'Widen the depth or clear the focus.']
            : ['Nothing matches these filters', 'Widen Show, Repos or Process in the row above.']
    return (
      <Empty title={title}>
        <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
      </Empty>
    )
  }

  const settling = laidOut !== key

  return (
    <div className="map-shell" style={{ height }}>
      <div className="map-canvas">
        {(settling || loading) && (
          <div className="map-settling">
            <span className="spinner" />
          </div>
        )}
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            flow.current = instance
            instance.fitView({ padding: 0.14, duration: 0 })
          }}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, n) => {
            setSelected(n.id)
            setThrough(null)
          }}
          onNodeDoubleClick={(_, n) => !pinned && !process && refocus(n.id)}
          onEdgeClick={(_, e) => setThrough(derived.get(e.id) ?? null)}
          onPaneClick={() => {
            setSelected(null)
            setThrough(null)
          }}
          onMove={(_, viewport) => setZoomedOut((was) => (viewport.zoom < 0.5) !== was ? viewport.zoom < 0.5 : was)}
          // Hand-arranged groups only line up if the hand is helped a little.
          snapToGrid
          snapGrid={[12, 12]}
          nodesConnectable={false}
          // d3-zoom's own double-click handler stops the event before React
          // ever sees it, and re-focusing is what a double click means here.
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: false }}
          minZoom={0.1}
          maxZoom={2.5}
        >
          {legendOpen ? (
            <Panel position="top-left" className="map-legend">
              <div className="stack" style={{ gap: 8 }}>
                <div className="map-legend-head">
                  <span className="nav-group-label">Key</span>
                  <button
                    type="button"
                    className="ghost"
                    aria-label="Hide the key"
                    onClick={() => {
                      setLegendOpen(false)
                      localStorage.setItem(LEGEND_KEY, 'closed')
                    }}
                  >
                    ×
                  </button>
                </div>

                <Legend
                  items={colourBy === 'team' ? teamLegend(view.candidates, teamSlot) : legend(view.candidates)}
                  hidden={colourBy === 'team' ? hiddenTeams : hiddenKinds}
                  onToggle={(id) =>
                    (colourBy === 'team' ? setHiddenTeams : setHiddenKinds)((was) => toggled(was, id))
                  }
                />

                {detail === 'services' && (
                  <Legend
                    shape="line"
                    items={relationLegend(view.candidateEdges)}
                    hidden={hiddenRelations}
                    onToggle={(id) => setHiddenRelations((was) => toggled(was, id))}
                  />
                )}

                <div className="segmented map-detail" role="group" aria-label="Detail">
                  {(['services', 'all'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={detail === mode}
                      onClick={() => {
                        setDetail(mode)
                        write(DETAIL_KEY + storageKey, mode)
                      }}
                    >
                      {mode === 'services' ? 'Services' : 'Everything'}
                    </button>
                  ))}
                </div>

                {teamSlot.size > 0 && (
                  <div className="segmented" role="group" aria-label="Colour by">
                    {(['kind', 'team'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={colourBy === mode}
                        onClick={() => {
                          setColourBy(mode)
                          try {
                            localStorage.setItem(COLOUR_KEY, mode)
                          } catch {
                            /* a private window is not a reason to fail */
                          }
                        }}
                      >
                        {mode === 'kind' ? 'Kind' : 'Team'}
                      </button>
                    ))}
                  </div>
                )}

                {Object.keys(placedByHand).length > 0 && (
                  <button type="button" className="ghost map-reset" onClick={resetLayout}>
                    Reset layout
                  </button>
                )}
              </div>
            </Panel>
          ) : (
            <Panel position="top-left" className="map-legend map-legend-shut">
              <button
                type="button"
                className="ghost"
                aria-label="Show the key"
                onClick={() => {
                  setLegendOpen(true)
                  localStorage.setItem(LEGEND_KEY, 'open')
                }}
              >
                Key
              </button>
            </Panel>
          )}

          {through && (
            <Panel position="top-right" className="map-through">
              <div className="map-legend-head">
                <span className="nav-group-label">{RELATION_LABEL[through.relation]}</span>
                <button type="button" className="ghost" aria-label="Close" onClick={() => setThrough(null)}>
                  ×
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                {name(through.from)} → {name(through.to)}, through:
              </p>
              <ul className="map-through-list">
                {through.through.map((t) => (
                  <li key={t.id}>
                    <Link to={nodeHref(t.id)}>{idValue(t.id)}</Link>{' '}
                    <span className="muted">{KIND_LABEL[t.kind as NodeKind] ?? t.kind}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={token.gridline} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            bgColor={token.surface}
            maskColor={token.mask}
            nodeColor={(n) => token.kinds[(n.data as MapNodeData)?.node?.kind] ?? token.axis}
            nodeStrokeWidth={2}
          />
        </ReactFlow>
      </div>

      <Inspector
        id={selected}
        open={open}
        onToggle={() => {
          setOpen((v) => {
            localStorage.setItem(INSPECTOR_KEY, v ? 'closed' : 'open')
            return !v
          })
        }}
        onFocus={pinned || process ? undefined : refocus}
      />
    </div>
  )
}

const DASH: Record<'solid' | 'dashed' | 'dotted', string | undefined> = {
  solid: undefined,
  dashed: '7 5',
  dotted: '1.5 4',
}

/** Every node one hop from the selection, for dimming the rest. */
function adjacency(edges: GraphEdge[], selected: string | null) {
  const near = new Set<string>()
  if (!selected) return near
  for (const e of edges) {
    if (e.from === selected) near.add(e.to)
    else if (e.to === selected) near.add(e.from)
  }
  return near
}

/**
 * React Flow paints the minimap, the markers and the background with concrete
 * colours, so the tokens have to be resolved rather than handed over as
 * `var(--x)`. `useThemeVersion` re-runs this when the theme changes.
 */
function useTokens(version: number) {
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement)
    const read = (name: string) => css.getPropertyValue(name).trim()
    return {
      axis: read('--axis'),
      accent: read('--accent'),
      gridline: read('--gridline'),
      surface: read('--surface-1'),
      text: read('--text-secondary'),
      mask: read('--hover-wash'),
      kinds: Object.fromEntries(
        Object.entries(KIND_COLOR).map(([kind, tokenName]) => [kind, read(tokenName)])
      ) as Record<string, string>,
      relations: Object.fromEntries(
        Object.entries(RELATION_COLOR).map(([rel, tokenName]) => [rel, read(tokenName)])
      ) as Record<Relation, string>,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
}

/* ----------------------------------------------------------- inspector */

function Inspector({
  id,
  open,
  onToggle,
  onFocus,
}: {
  id: string | null
  open: boolean
  onToggle: () => void
  onFocus?: (id: string) => void
}) {
  const [detail, setDetail] = useState<NodeDetail | null>(null)

  useEffect(() => {
    setDetail(null)
    if (!id || !open) return
    let cancelled = false
    api
      .get<NodeDetail>('/node', { id })
      .then((d) => !cancelled && setDetail(d))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, open])

  if (!open) {
    return (
      <button type="button" className="ghost map-inspector-tab" onClick={onToggle} aria-label="Show the inspector">
        ‹
      </button>
    )
  }

  return (
    <aside className="map-inspector">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="nav-group-label">Inspector</span>
        <button type="button" className="ghost" onClick={onToggle} aria-label="Hide the inspector">
          ›
        </button>
      </div>

      {!id ? (
        <p className="muted" style={{ fontSize: 12 }}>
          Click a node to see what it is and where that is written down. Double-click to recentre the
          map on it.
        </p>
      ) : !detail ? (
        <span className="spinner" />
      ) : (
        <NodeSummary detail={detail} onFocus={onFocus} />
      )}
    </aside>
  )
}

function NodeSummary({ detail, onFocus }: { detail: NodeDetail; onFocus?: (id: string) => void }) {
  const { node } = detail
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 14 }}>{node.name}</h3>
        <p className="muted" style={{ fontSize: 12, margin: '3px 0 0' }}>
          <span className="pill">{KIND_LABEL[node.kind]}</span>{' '}
          {node.ownerRepo ? <code>{node.ownerRepo}</code> : 'no owning repo'}
          {node.team ? ` · ${node.team}` : ''}
        </p>
      </div>

      <code className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
        {node.id}
      </code>

      {node.description && <p style={{ fontSize: 12, margin: 0 }}>{node.description}</p>}

      {node.orphan && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Referenced by a scanned repo but never declared by one — the other end is probably outside
          the scanned set.
        </p>
      )}

      {detail.drift.length > 0 && (
        <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 16, fontSize: 12 }}>
          {detail.drift.map((f) => (
            <li key={f.id}>
              <strong>{f.kind}</strong> — {f.detail}
            </li>
          ))}
        </ul>
      )}

      <div>
        <span className="nav-group-label">
          Evidence{detail.evidence.length > 3 ? ` · first 3 of ${detail.evidence.length}` : ''}
        </span>
        {detail.evidence.length ? (
          <ul className="evidence-list">
            {detail.evidence.slice(0, 3).map((e) => (
              <Citation key={e.id} evidence={e} />
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Nothing cites this node directly; its edges carry the evidence.
          </p>
        )}
      </div>

      <div className="row" style={{ gap: 10 }}>
        <Link to={nodeHref(node.id)}>Open details →</Link>
        {onFocus && (
          <button type="button" className="ghost" onClick={() => onFocus(node.id)}>
            Centre the map here
          </button>
        )}
      </div>
    </div>
  )
}

function Citation({ evidence }: { evidence: Evidence }) {
  return (
    <li>
      <div className="evidence-where muted">
        <code>
          {evidence.repo} · {evidence.file}:{evidence.line}
        </code>
      </div>
      <pre className="evidence-snippet">
        <code>{evidence.snippet}</code>
      </pre>
    </li>
  )
}

/**
 * The teams on screen, in the order they took their colours. Like legend()
 * this reads the unfiltered graph, so a team switched off is still listed. A team past the
 * eighth has none — the tokens are documented as never cycled — so it is drawn
 * muted and the legend says how many, rather than silently reusing a colour.
 */
function teamLegend(nodes: GraphNode[], slots: Map<string, string>) {
  const named = new Map(nodes.filter((n) => n.teamId).map((n) => [n.teamId!, n.teamName ?? n.teamId!]))
  const items = [...slots].map(([id, tokenName]) => ({
    id,
    label: named.get(id) ?? id,
    color: `var(${tokenName})`,
  }))
  const uncoloured = [...named.keys()].filter((id) => !slots.has(id)).length
  const teamless = nodes.filter((n) => !n.teamId).length
  if (uncoloured || teamless) {
    items.push({
      id: TEAMLESS,
      label: uncoloured
        ? `${uncoloured} more team${uncoloured === 1 ? '' : 's'}, and ${teamless} with none`
        : `${teamless} with no team`,
      color: `var(${NO_TEAM_COLOR})`,
    })
  }
  return items
}

/** Only the kinds this detail level can show — a key for absent things is noise. */
function legend(nodes: GraphNode[]) {
  const present = [...new Set(nodes.map((n) => n.kind))].sort()
  return present.map((kind) => ({
    id: kind,
    label: KIND_LABEL[kind],
    color: `var(${KIND_COLOR[kind]})`,
  }))
}

/** The kinds of relationship the derived lines stand for, in a fixed order. */
function relationLegend(edges: GraphEdge[]) {
  const present = new Set(edges.filter(isDerived).map((e) => e.relation))
  return RELATIONS.filter((r) => present.has(r)).map((r) => ({
    id: r,
    label: RELATION_LABEL[r],
    color: `var(${RELATION_COLOR[r]})`,
  }))
}

/** What a derived line is carrying, short enough to sit on the line. */
function throughLabel(e: ServiceEdge) {
  if (e.through.length === 1) return idValue(e.through[0].id)
  const kinds = new Set(e.through.map((t) => t.kind))
  const noun = kinds.size === 1 ? (KIND_PLURAL[[...kinds][0] as NodeKind] ?? 'things') : 'things'
  return `${e.through.length} ${noun.toLowerCase()}`
}

/** A Set with one member flipped. Sets are state here, so this returns a new one. */
function toggled(was: Set<string>, id: string) {
  const next = new Set(was)
  if (!next.delete(id)) next.add(id)
  return next
}
