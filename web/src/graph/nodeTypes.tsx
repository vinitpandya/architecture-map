import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { GraphNode } from '../lib/api'
import { KIND_COLOR, KIND_LABEL } from '../lib/nodes'

/**
 * One component per node kind. Shape carries the kind so the map is readable
 * without consulting the legend: a topic is a pill, a store has a cylinder, a
 * contract and an external are dashed because neither is a deployable thing.
 *
 * Fill is the kind's token at 14% over the surface with a full-strength
 * border, never a saturated block — a screen of solid colour is unreadable
 * long before it is dense.
 */

export type MapNodeData = {
  node: GraphNode
  focused: boolean
  selected: boolean
  /** Dimmed when something else is selected and this is not its neighbour. */
  faded: boolean
  showLabel: boolean
  /** A theme token name, when the map is colouring by something else. */
  color?: string
}

function Shell({ data, extra, glyph }: { data: MapNodeData; extra?: string; glyph?: JSX.Element }) {
  const { node, focused, selected, faded, showLabel } = data
  const classes = [
    'map-node',
    node.kind.replace('kafka.', ''),
    node.orphan ? 'orphan' : '',
    focused ? 'focused' : '',
    selected ? 'selected' : '',
    faded ? 'faded' : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      style={{ ['--node-color' as string]: `var(${data.color ?? KIND_COLOR[node.kind]})` }}
      title={`${KIND_LABEL[node.kind]} · ${node.id}`}
    >
      <Handle type="target" position={Position.Left} className="map-handle" />
      {showLabel ? (
        <>
          <span className="map-node-kind">
            {glyph}
            {KIND_LABEL[node.kind]}
            {node.orphan ? ' · not declared' : ''}
          </span>
          <span className="map-node-label">{node.name}</span>
        </>
      ) : (
        <span className="map-node-label" aria-label={node.name}>
          &nbsp;
        </span>
      )}
      <Handle type="source" position={Position.Right} className="map-handle" />
    </div>
  )
}

const Service = (p: NodeProps) => <Shell data={p.data as MapNodeData} extra="service" />
const Topic = (p: NodeProps) => <Shell data={p.data as MapNodeData} />
const Endpoint = (p: NodeProps) => <Shell data={p.data as MapNodeData} extra="endpoint" />
const Contract = (p: NodeProps) => <Shell data={p.data as MapNodeData} />
const External = (p: NodeProps) => <Shell data={p.data as MapNodeData} />
const Store = (p: NodeProps) => <Shell data={p.data as MapNodeData} glyph={<Cylinder />} />

/** Keyed by node kind, so /api/graph's `kind` is the React Flow node type. */
export const nodeTypes = {
  service: Service,
  'kafka.topic': Topic,
  database: Store,
  cache: Store,
  endpoint: Endpoint,
  contract: Contract,
  external: External,
}

function Cylinder() {
  return (
    <svg
      className="map-node-glyph"
      width="9"
      height="11"
      viewBox="0 0 9 11"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="4.5" cy="2.2" rx="3.7" ry="1.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M0.8 2.2v6.6c0 .9 1.7 1.6 3.7 1.6s3.7-.7 3.7-1.6V2.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
