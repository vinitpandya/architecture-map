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

/** The four sides a line may leave or arrive at, in clockwise order. */
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const

export type MapNodeData = {
  node: GraphNode
  focused: boolean
  selected: boolean
  /** Dimmed when something else is selected and this is not its neighbour. */
  faded: boolean
  showLabel: boolean
  /** A theme token name, when the map is colouring by something else. */
  color?: string
  /**
   * How many things this service reaches for that could not be drawn as a
   * line — an endpoint nobody scanned exposes, a bus half the estate shares.
   * Zero on every node at full detail, where each of them is drawn as itself.
   */
  loose?: number
}

function Shell({ data, extra, glyph }: { data: MapNodeData; extra?: string; glyph?: JSX.Element }) {
  const { node, focused, selected, faded, showLabel, loose } = data
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
      {/* A handle on every side, for both ends of a line.

          With one target on the left and one source on the right, a line to
          something above, below or behind had to leave the right edge, travel
          round the box and come back in on the left — a crossing the graph
          did not have, invented by the drawing. MapCanvas picks the pair
          facing the other node; these are the eight it picks from. */}
      {SIDES.map((side) => (
        <Handle key={`t-${side}`} id={`t-${side}`} type="target" position={side} className="map-handle" />
      ))}
      {SIDES.map((side) => (
        <Handle key={`s-${side}`} id={`s-${side}`} type="source" position={side} className="map-handle" />
      ))}
      {showLabel ? (
        <>
          <span className="map-node-kind">
            {glyph}
            {KIND_LABEL[node.kind]}
            {node.orphan ? ' · not declared' : ''}
            {/* What this service reaches for that the map could not join up.
                In the kind row rather than floating over the box: the node
                clips its overflow, and a badge hanging off the corner would
                be cut off or would change the box the layout measured. */}
            {!!loose && (
              <span
                className="map-node-loose"
                title={`${loose} ${loose === 1 ? 'connection' : 'connections'} that could not be drawn as a line — open the inspector`}
              >
                {loose}
              </span>
            )}
          </span>
          <span className="map-node-label">{node.name}</span>
        </>
      ) : (
        <span className="map-node-label" aria-label={node.name}>
          &nbsp;
        </span>
      )}
    </div>
  )
}

const Service = (p: NodeProps) => <Shell data={p.data as MapNodeData} extra="service" />
const Topic = (p: NodeProps) => <Shell data={p.data as MapNodeData} />
const Endpoint = (p: NodeProps) => <Shell data={p.data as MapNodeData} extra="endpoint" />
const Contract = (p: NodeProps) => <Shell data={p.data as MapNodeData} />
const External = (p: NodeProps) => <Shell data={p.data as MapNodeData} />
const Store = (p: NodeProps) => <Shell data={p.data as MapNodeData} glyph={<Cylinder />} />

/**
 * The box an arrangement draws round a group — a team, or a column of one kind.
 *
 * Not a React Flow parent node: a parent re-bases its children's coordinates,
 * which would fight both the saved hand-placed positions and the drag that
 * produces them. This is an ordinary node sized by the layout, painted behind
 * everything and deaf to the mouse, so a click aimed at what is inside it
 * lands on what is inside it.
 */
export type MapGroupData = { label: string }

function Group({ data }: NodeProps) {
  const { label } = data as MapGroupData
  return (
    <div className="map-group">
      <span className="map-group-label">{label}</span>
    </div>
  )
}

/** Keyed by node kind, so /api/graph's `kind` is the React Flow node type. */
export const nodeTypes = {
  service: Service,
  'kafka.topic': Topic,
  database: Store,
  cache: Store,
  endpoint: Endpoint,
  contract: Contract,
  external: External,
  group: Group,
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
