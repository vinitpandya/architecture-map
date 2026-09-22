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
import { Banner, Empty, Legend, useThemeVersion } from '../components/ui'
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
import {
  ARRANGEMENT_LABEL,
  ARRANGEMENT_SUB,
  LAYOUT_DEADLINE_SECONDS,
  isLayoutTooBig,
  layoutGraph,
  layoutKey,
  nodeSize,
  type Arrangement,
  type Group,
  type Position,
} from './layout'
import { nodeTypes, type MapGroupData, type MapNodeData } from './nodeTypes'
import { Chord } from './Chord'
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
const ISOLATE_KEY = 'architecture-map.isolate.'
const ARRANGE_KEY = 'architecture-map.arrangement.'
const ARRANGEMENTS: Arrangement[] = ['compact', 'teams', 'columns', 'crossings']
const SURFACE_KEY = 'architecture-map.surface.'

/**
 * The map draws the topology; the chord draws the traffic. Past a few dozen
 * services the first is a hairball and the second still reads, so they are two
 * views of one card rather than two cards.
 */
type Surface = 'map' | 'chord'

/**
 * How far from the selection the map keeps drawing. 0 is off — the selection
 * dims its non-neighbours and everything stays on screen. Anything else hides
 * the rest entirely.
 *
 * The filter row's `focus` and `depth` ask the same question of the server and
 * answer it by changing what the graph *is*. This asks it of what is already on
 * screen: one click, no refetch, no URL, and it works inside a widget that has
 * no filter row. Reaching for it is what you do when a screen has too many
 * lines to read, which is a different moment from deciding what the map covers.
 */
const HOPS = [0, 1, 2, Infinity] as const

/** One array for "nothing yet", so an absent graph is not a new dependency
 *  on every render. */
const EMPTY_NODES: GraphNode[] = []
type Hops = (typeof HOPS)[number]

const HOP_LABEL = (h: Hops) => (h === 0 ? 'Off' : h === Infinity ? 'All' : String(h))

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
/** Hand-placed nodes are per map, per detail level and per arrangement. The
 *  two levels do not share a node set and the four arrangements do not share a
 *  starting point, so a drag made against one means nothing against another. */
const layoutSlot = (storageKey: string, detail: Detail, arrangement: Arrangement) =>
  `${LAYOUT_KEY}${storageKey}.${detail}.${arrangement}`

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
  const [groups, setGroups] = useState<Group[]>([])
  const [surface, setSurface] = useState<Surface>(() =>
    read<Surface>(SURFACE_KEY + storageKey, 'map') === 'chord' ? 'chord' : 'map'
  )
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const saved = read<Arrangement>(ARRANGE_KEY + storageKey, 'compact')
    return ARRANGEMENTS.includes(saved) ? saved : 'compact'
  })
  const [laidOut, setLaidOut] = useState('')
  /** Why the last layout produced nothing, if it produced nothing. */
  const [failed, setFailed] = useState<{ title: string; hint: string } | null>(null)
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
  /** How far from the selection to keep drawing. 0 leaves the map whole. */
  const [isolate, setIsolate] = useState<Hops>(() => {
    const saved = read<number | null>(ISOLATE_KEY + storageKey, null)
    return HOPS.includes(saved as Hops) ? (saved as Hops) : saved === null ? 0 : Infinity
  })
  /** Hand-placed nodes, overlaid on the computed layout. */
  const [placedByHand, setPlacedByHand] = useState<Record<string, Position>>({})
  /** The derived line whose intermediaries are on screen. */
  const [through, setThrough] = useState<ServiceEdge | null>(null)

  const flow = useRef<ReactFlowInstance | null>(null)
  const urlFocus = useRef<string | null>(null)

  const all = useMemo(() => data?.nodes ?? EMPTY_NODES, [data])
  /* Keyed on the teams themselves rather than on the array holding them. The
     array is a fresh `[]` on every render before the graph arrives, and React
     18's StrictMode re-runs a memo's factory to prove it is pure — either way
     an identity dep here re-made this Map on every render, and `computed`
     below takes it as a dependency, so `setRfNodes` ran on every render and
     asked for another one. That is the loop. */
  const teamKey = all.map((n) => n.teamId ?? '').join('\u0000')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const teamSlot = useMemo(() => teamColours(all.map((n) => n.teamId)), [teamKey])

  // What is actually drawn: the collapse, then whatever the key has switched
  // off. Hiding a kind removes its nodes and every line that ran through one.
  const view = useMemo(() => {
    const empty: GraphNode[] = []
    const noEdges: GraphEdge[] = []
    if (!data) {
      return { nodes: empty, edges: noEdges, candidates: empty, candidateEdges: noEdges, isolated: false, hidden: 0 }
    }
    const base: GraphData = detail === 'services' ? collapseToServices(data) : data
    const gone = (n: GraphNode) =>
      colourBy === 'team' ? hiddenTeams.has(n.teamId ?? TEAMLESS) : hiddenKinds.has(n.kind)
    const nodes = base.nodes.filter((n) => !gone(n))
    const live = new Set(nodes.map((n) => n.id))
    const edges = base.edges.filter(
      (e) => live.has(e.from) && live.has(e.to) && !(isDerived(e) && hiddenRelations.has(e.relation))
    )

    /* Isolation, last, and over what the key left: hiding a kind and then
       isolating has to mean "two hops through what I can see", not "two hops
       through things I switched off and out the other side". */
    const reached = isolate && selected && live.has(selected) ? within(edges, selected, isolate) : null
    return {
      nodes: reached ? nodes.filter((n) => reached.has(n.id)) : nodes,
      edges: reached ? edges.filter((e) => reached.has(e.from) && reached.has(e.to)) : edges,
      // The key is drawn from what this detail level *could* show, not from
      // what survived the toggles: a row that vanishes when you switch it off
      // leaves no way to switch it back on.
      candidates: base.nodes,
      candidateEdges: base.edges,
      isolated: !!reached,
      hidden: reached ? nodes.length - reached.size : 0,
    }
  }, [data, detail, colourBy, hiddenKinds, hiddenTeams, hiddenRelations, isolate, selected])

  const nodes = view.nodes
  const edges = view.edges
  const key = useMemo(() => layoutKey(nodes, edges, arrangement), [nodes, edges, arrangement])

  // Detail level and map identity each pick a different saved arrangement.
  useEffect(() => {
    setPlacedByHand(read<Record<string, Position>>(layoutSlot(storageKey, detail, arrangement), {}))
    setThrough(null)
  }, [storageKey, detail, arrangement])

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
      setGroups([])
      setLaidOut(key)
      return
    }
    let cancelled = false
    setFailed(null)
    layoutGraph(nodes, edges, arrangement)
      .then((next) => {
        if (cancelled) return
        setPositions(next.positions)
        setGroups(next.groups)
        setFailed(null)
        setLaidOut(key)
        requestAnimationFrame(() => flow.current?.fitView({ padding: 0.14, duration: 0 }))
      })
      /* Without this the spinner runs for ever and a graph elk could not lay
         out looks exactly like one it is still laying out. Marking the key as
         done is what stops it: there is nothing more coming for this graph. */
      .catch((err: unknown) => {
        if (cancelled) return
        setFailed(
          isLayoutTooBig(err)
            ? {
                title: `Too tangled to arrange (${err.nodes} nodes, ${err.edges} lines)`,
                hint: `Still going after ${LAYOUT_DEADLINE_SECONDS}s, so it was stopped. Narrow it — focus a node, pick a team, or switch to Services — or use Columns, which never needs arranging.`,
              }
            : {
                title: 'That arrangement failed',
                hint: `${err instanceof Error ? err.message : String(err)} — Columns does not use the same engine and should still draw.`,
              }
        )
        setLaidOut(key)
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
    // The boxes first, so they are behind everything in DOM order as well as
    // by zIndex — React Flow paints in array order within a z layer.
    const boxes: Node[] = groups.map((g) => ({
      id: g.id,
      type: 'group',
      position: { x: g.x, y: g.y },
      data: { label: g.label } satisfies MapGroupData,
      width: g.width,
      height: g.height,
      zIndex: 0,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
    }))
    return boxes.concat(nodes.map((n) => ({
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
    })))
    // colourBy and teamSlot are in here because the node's colour is part of
    // its data: without them the legend switched and the nodes did not.
  }, [nodes, groups, positions, placedByHand, focus, selected, neighbours, showLabel, colourBy, teamSlot])

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
        for (const n of dragged) {
          if (n.type === 'group') continue
          next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        }
        write(layoutSlot(storageKey, detail, arrangement), next)
        return next
      })
    },
    [storageKey, detail, arrangement]
  )
  const resetLayout = useCallback(() => {
    setPlacedByHand({})
    write(layoutSlot(storageKey, detail, arrangement), {})
    requestAnimationFrame(() => flow.current?.fitView({ padding: 0.14, duration: 240 }))
  }, [storageKey, detail, arrangement])

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const { source, target } = flowDirection(e)
        // Lit by its own selection as well as by either end's, so the line the
        // Through panel is describing is the line you can see.
        const lit = through?.id === e.id || (!!selected && (e.from === selected || e.to === selected))
        // A line in the service view is drawn in the colour of the
        // relationship it stands for. A scanned edge stays on the axis colour:
        // the node it lands on already carries the kind.
        const stands = isDerived(e) ? e : null
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
          label:
            lit && showLabel
              ? stands?.through.length
                ? throughLabel(stands)
                : EDGE_LABEL[e.kind]
              : undefined,
          labelStyle: { fill: token.text, fontSize: 10 },
          labelBgStyle: { fill: token.surface, fillOpacity: 0.92 },
          labelBgPadding: [4, 2] as [number, number],
        }
      }),
    [edges, selected, through, token, showLabel]
  )

  const derived = useMemo(() => {
    const out = new Map<string, ServiceEdge>()
    for (const e of edges) if (isDerived(e) && e.through.length > 0) out.set(e.id, e)
    return out
  }, [edges])
  useEffect(() => {
    if (through && !derived.has(through.id)) setThrough(null)
  }, [derived, through])
  const name = useCallback((id: string) => all.find((n) => n.id === id)?.name ?? idValue(id), [all])

  /* The chord is always service-to-service, whatever the map's detail level
     says — so its key is drawn from the collapse rather than from `view`,
     which at full detail holds scanned edges with no relation on them and
     would leave the key empty. */
  const chordEdges = useMemo(() => (data ? collapseToServices(data).edges : []), [data])

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

  const surfaceToggle = (
    <div className="segmented map-surface" role="group" aria-label="View">
      {(['map', 'chord'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={surface === v}
          onClick={() => {
            setSurface(v)
            write(SURFACE_KEY + storageKey, v)
          }}
        >
          {v === 'map' ? 'Map' : 'Chord'}
        </button>
      ))}
    </div>
  )

  if (surface === 'chord') {
    return (
      <div className="map-shell" style={{ height }}>
        <div className="map-canvas map-canvas-plain">
          <div className={`map-legend map-legend-float${legendOpen ? '' : ' map-legend-shut'}`}>
            {!legendOpen ? (
              <>
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
                {surfaceToggle}
              </>
            ) : (
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
                shape="line"
                items={relationLegend(chordEdges)}
                hidden={hiddenRelations}
                onToggle={(id) => setHiddenRelations((was) => toggled(was, id))}
              />
              {surfaceToggle}
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
            </div>
            )}
          </div>
          {data && (
            <Chord
              data={data}
              height={height - 8}
              colourBy={colourBy}
              teamSlot={teamSlot}
              hiddenRelations={hiddenRelations}
              selected={selected}
              onSelect={setSelected}
            />
          )}
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

  return (
    <div className="map-shell" style={{ height }}>
      <div className="map-canvas">
        {(settling || loading) && (
          <div className="map-settling">
            <span className="spinner" />
          </div>
        )}
        {failed && !settling && (
          <div className="map-settling map-failed">
            <Banner
              kind="warn"
              title={failed.title}
              actions={
                arrangement === 'columns' ? undefined : (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setArrangement('columns')
                      write(ARRANGE_KEY + storageKey, 'columns')
                    }}
                  >
                    Use Columns
                  </button>
                )
              }
            >
              {failed.hint}
            </Banner>
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
            if (n.type === 'group') return
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
                  items={colourBy === 'team' ? teamLegend(view.candidates, all, teamSlot) : legend(view.candidates)}
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

                {/* Two to a row. Seven controls stacked made the key a column
                    tall enough to sit on the nodes underneath it, which is a
                    key that has stopped being a key. */}
                <div className="map-controls">
                  {surfaceToggle}

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

                  <select
                    className="map-arrange"
                    aria-label="Arrangement"
                    title={ARRANGEMENT_SUB[arrangement]}
                    value={arrangement}
                    onChange={(e) => {
                      const next = e.target.value as Arrangement
                      setArrangement(next)
                      write(ARRANGE_KEY + storageKey, next)
                    }}
                  >
                    {ARRANGEMENTS.map((a) => (
                      <option key={a} value={a}>
                        {ARRANGEMENT_LABEL[a]}
                      </option>
                    ))}
                  </select>

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

                  {selected && (
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span className="nav-group-label">Isolate</span>
                      <div className="segmented map-isolate" role="group" aria-label="Isolate">
                        {HOPS.map((h) => (
                          <button
                            key={String(h)}
                            type="button"
                            aria-pressed={isolate === h}
                            title={
                              h === 0
                                ? 'Keep the whole map, dimming what the selection does not touch'
                                : h === Infinity
                                  ? 'Everything the selection can reach, however far'
                                  : `Everything within ${h} ${h === 1 ? 'hop' : 'hops'}`
                            }
                            onClick={() => {
                              setIsolate(h)
                              write(ISOLATE_KEY + storageKey, h === Infinity ? -1 : h)
                            }}
                          >
                            {HOP_LABEL(h)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {Object.keys(placedByHand).length > 0 && (
                    <button type="button" className="ghost map-reset" onClick={resetLayout}>
                      Reset layout
                    </button>
                  )}
                </div>
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
              {/* The way to the chord lives in the key, and the key can be
                  shut — so it comes out with it, or shutting the key is a door
                  locking behind you. */}
              {surfaceToggle}
            </Panel>
          )}

          {/* One panel for both, stacked. Two panels at one corner overlap, and
              every other corner is taken: the key top-left, React Flow's own
              controls bottom-left and its minimap bottom-right — which is what
              the isolate banner was landing underneath. */}
          {(view.isolated || through) && (
            <Panel position="top-right" className="map-aside">
              {view.isolated && (
                <div className="map-isolated">
                  <span>
                    Isolated to <strong>{name(selected!)}</strong>
                    {isolate === Infinity
                      ? ', and everything it reaches'
                      : `, ${isolate} ${isolate === 1 ? 'hop' : 'hops'} out`}
                  </span>
                  <span className="muted">{view.hidden} hidden</span>
                  <button type="button" className="ghost" onClick={() => setIsolate(0)}>
                    Show the rest
                  </button>
                </div>
              )}

              {through && (
                <div className="map-through">
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
                </div>
              )}
            </Panel>
          )}
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={token.gridline} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            bgColor={token.surface}
            maskColor={token.mask}
            nodeColor={(n) =>
              n.type === 'group' ? 'transparent' : token.kinds[(n.data as MapNodeData)?.node?.kind] ?? token.axis
            }
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

/**
 * Everything within `hops` of a node, the node itself included.
 *
 * Undirected on purpose. "What does this topic connect to" means its producers
 * and its consumers, and a reader isolating an endpoint wants the service that
 * serves it as much as the ones that call it — the direction is on the arrow
 * once they are on screen.
 */
function within(edges: GraphEdge[], from: string, hops: number) {
  const near = new Map<string, string[]>()
  for (const e of edges) {
    if (!near.has(e.from)) near.set(e.from, [])
    if (!near.has(e.to)) near.set(e.to, [])
    near.get(e.from)!.push(e.to)
    near.get(e.to)!.push(e.from)
  }
  const seen = new Set([from])
  let frontier = [from]
  for (let hop = 0; hop < hops && frontier.length; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const other of near.get(id) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
      }
    }
    // Collected per hop rather than appended while iterating: the bug §14
    // caught in /api/graph's BFS, which walked the whole component at depth 1.
    frontier = next
  }
  return seen
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
  /* The resolved team, not `node.team`, which is the string the scan found in
     the manifest. After a merge or a rename the two disagree, and this is the
     one the map colours by — the panel and the picture have to say the same
     thing about the same node. */
  const team = node.teamName ?? node.teamId
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 14 }}>{node.name}</h3>
        <p className="muted" style={{ fontSize: 12, margin: '3px 0 0' }}>
          <span className="pill">{KIND_LABEL[node.kind]}</span>{' '}
          {node.ownerRepo ? <code>{node.ownerRepo}</code> : 'no owning repo'}
          {team ? ` · ${team}` : ''}
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
function teamLegend(nodes: GraphNode[], everything: GraphNode[], slots: Map<string, string>) {
  // Names off the whole graph, because the colours are assigned off the whole
  // graph and a slot with nothing on screen would otherwise read as its id.
  const named = new Map(everything.filter((n) => n.teamId).map((n) => [n.teamId!, n.teamName ?? n.teamId!]))
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
