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
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, type Evidence, type GraphData, type GraphEdge, type GraphNode, type NodeDetail } from '../lib/api'
import { useQuery, useScope } from '../lib/scope'
import { Empty, Legend, useThemeVersion } from '../components/ui'
import { EDGE_LABEL, KIND_COLOR, KIND_LABEL, edgeStyle, flowDirection, nodeHref } from '../lib/nodes'
import { layoutGraph, layoutKey, nodeSize, type Position } from './layout'
import { nodeTypes, type MapNodeData } from './nodeTypes'

/** Above this, labels go away below 0.5 zoom — §11. */
const LABEL_BUDGET = 150
const INSPECTOR_KEY = 'architecture-map.inspector'

export function MapCanvas({
  height,
  focus,
  depth,
  pinned = false,
}: {
  height: number
  focus: string
  depth: string
  /** A map fixed to one node by its widget options ignores the filter row. */
  pinned?: boolean
}) {
  const { data, loading } = useQuery<GraphData>('/graph', { focus, depth })
  const { setScope } = useScope()
  const [params, setParams] = useSearchParams()
  const theme = useThemeVersion()

  const [positions, setPositions] = useState<Record<string, Position> | null>(null)
  const [laidOut, setLaidOut] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [zoomedOut, setZoomedOut] = useState(false)
  const [open, setOpen] = useState(() => localStorage.getItem(INSPECTOR_KEY) !== 'closed')
  const flow = useRef<ReactFlowInstance | null>(null)
  const urlFocus = useRef<string | null>(null)

  const nodes = data?.nodes ?? []
  const edges = data?.edges ?? []
  const key = useMemo(() => layoutKey(nodes, edges), [nodes, edges])

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
    if (pinned) return
    const fromUrl = params.get('focus')
    if (fromUrl === urlFocus.current) return
    urlFocus.current = fromUrl
    setScope({ focus: fromUrl ?? '', depth: params.get('depth') ?? '1' })
  }, [params, pinned, setScope])

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

  const rfNodes: Node[] = useMemo(() => {
    if (!positions) return []
    return nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: {
        node: n,
        focused: n.id === focus,
        selected: n.id === selected,
        faded: !!selected && n.id !== selected && !neighbours.has(n.id),
        showLabel,
      } satisfies MapNodeData,
      ...nodeSize(n),
      draggable: false,
      selectable: true,
      connectable: false,
    }))
  }, [nodes, positions, focus, selected, neighbours, showLabel])

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const { source, target } = flowDirection(e)
        const lit = !!selected && (e.from === selected || e.to === selected)
        const stroke = lit ? token.accent : token.axis
        return {
          id: e.id,
          source,
          target,
          type: 'smoothstep',
          zIndex: lit ? 2 : 1,
          style: { stroke, strokeWidth: lit ? 1.8 : 1.1, strokeDasharray: DASH[edgeStyle(e.kind)] },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 13, height: 13 },
          label: lit && showLabel ? EDGE_LABEL[e.kind] : undefined,
          labelStyle: { fill: token.text, fontSize: 10 },
          labelBgStyle: { fill: token.surface, fillOpacity: 0.92 },
          labelBgPadding: [4, 2] as [number, number],
        }
      }),
    [edges, selected, token, showLabel]
  )

  if (!data && !positions) return <div className="map-loading" style={{ height }}><span className="spinner" /></div>
  if (data && !nodes.length) {
    return (
      <Empty title={focus ? 'Nothing connected to that node' : 'Nothing ingested yet'}>
        <span className="muted" style={{ fontSize: 12 }}>
          {focus ? 'Widen the depth or clear the focus.' : 'Run a scan, or npm run seed:demo for the sample estate.'}
        </span>
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
          onNodeClick={(_, n) => setSelected(n.id)}
          onNodeDoubleClick={(_, n) => !pinned && refocus(n.id)}
          onPaneClick={() => setSelected(null)}
          onMove={(_, viewport) => setZoomedOut((was) => (viewport.zoom < 0.5) !== was ? viewport.zoom < 0.5 : was)}
          nodesDraggable={false}
          nodesConnectable={false}
          // d3-zoom's own double-click handler stops the event before React
          // ever sees it, and re-focusing is what a double click means here.
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: false }}
          minZoom={0.1}
          maxZoom={2.5}
        >
          <Panel position="top-left" className="map-legend">
            <Legend items={legend(nodes)} />
          </Panel>
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
        onFocus={pinned ? undefined : refocus}
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

/** Only the kinds actually on screen — a legend for absent things is noise. */
function legend(nodes: GraphNode[]) {
  const present = [...new Set(nodes.map((n) => n.kind))].sort()
  return present.map((kind) => ({
    id: kind,
    label: KIND_LABEL[kind],
    color: `var(${KIND_COLOR[kind]})`,
  }))
}
