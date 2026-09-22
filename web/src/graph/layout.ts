import type { ELK as ElkInstance, ElkNode } from 'elkjs/lib/elk-api'
import type { GraphEdge, GraphNode, NodeKind } from '../lib/api'
import { KIND_PLURAL, flowDirection } from '../lib/nodes'

/**
 * Layered layout, never force. A service has to be in the same place on every
 * visit or the map stops being something people can build a mental picture
 * from — and a node that drifts between loads is indistinguishable from a
 * node whose relationships changed.
 *
 * elk's layered algorithm is deterministic for a given input, so the only
 * thing this file has to guarantee is that the input is too: nodes and edges
 * are sorted by id before they go in.
 */

/*
 * elk runs in a worker, and against a clock.
 *
 * Layered layout is not merely slow on a large estate, it is unbounded. A
 * synthetic estate of 182 nodes with one shared audit topic took 35s in node;
 * a denser one threw `RangeError: Maximum call stack size exceeded`; the same
 * graph in Chromium had not finished after a hundred seconds. On the main
 * thread none of those is a slow map — it is a dead tab, with no spinner, no
 * cancel and no way back.
 *
 * Off the main thread the tab stays alive, and a layout that is never going
 * to finish can be abandoned. Both matter: the worker alone would still leave
 * a map that spins for ever. Loading it lazily also keeps elk's bundle — still
 * larger than the rest of the app put together — off the initial page load.
 */
let engine: Promise<ElkInstance> | null = null
const elk = () => {
  if (!engine) {
    engine = Promise.all([
      import('elkjs/lib/elk-api'),
      import('elkjs/lib/elk-worker.min.js?worker'),
    ]).then(([api, worker]) => new api.default({ workerFactory: () => new worker.default() }))
  }
  return engine
}

/** A worker that blew the deadline is mid-layout and will never answer, so it
 *  is thrown away rather than reused; the next map builds a fresh one. */
const discardEngine = () => {
  const dead = engine
  engine = null
  void dead?.then((e) => e.terminateWorker()).catch(() => {})
}

/**
 * How long a layout may take before the worker is killed.
 *
 * Layered layout's cost follows the graph's shape rather than its size — a
 * synthetic 122-node estate took 16s where a 152-node one took 12s — so no
 * node count reliably separates "fine" from "never finishes". A clock does,
 * and it needs no guess about which graphs are hard. Ten seconds is far
 * longer than any layout that was going to succeed (the demo estate is under
 * one) and far shorter than a hang.
 */
const DEADLINE_MS = 10_000

const TOO_BIG = 'layout-too-big'

/** Whether a layout was abandoned on the deadline rather than failing outright. */
export const isLayoutTooBig = (err: unknown): err is Error & { nodes: number; edges: number } =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === TOO_BIG

/** How long the reader was asked to wait before being told it would not finish. */
export const LAYOUT_DEADLINE_SECONDS = DEADLINE_MS / 1000

/**
 * Four ways of arranging the same graph, because one arrangement cannot answer
 * every question. All four are deterministic — a node has to be in the same
 * place on every visit or the map stops being something people build a mental
 * picture from.
 */
export type Arrangement = 'compact' | 'teams' | 'columns' | 'crossings'

export const ARRANGEMENT_LABEL: Record<Arrangement, string> = {
  compact: 'Compact',
  teams: 'Teams',
  columns: 'Columns',
  crossings: 'Fewest crossings',
}

export const ARRANGEMENT_SUB: Record<Arrangement, string> = {
  compact: 'Layered, wrapped to fill the panel',
  teams: 'A box per team — what leaves one is a cross-team dependency',
  columns: 'One column per kind, sorted by name',
  crossings: 'Layered, unwrapped, with crossings minimised harder — taller, and clearest',
}

const LAYERED = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
  'elk.spacing.nodeNode': '48',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
}

const OPTIONS: Record<'compact' | 'teams' | 'crossings', Record<string, string>> = {
  /*
   * An estate is mostly a long dependency chain, and laid out in one run of
   * layers it comes out as a ribbon: 1968×214 for the demo estate at service
   * level, nine times wider than it is tall. Fitted to a landscape panel that
   * is a row of unreadable specks.
   *
   * So the layers wrap, the way a paragraph does, once they pass this ratio —
   * and only then: a graph that is already squarer is laid out exactly as it
   * was before. Same layered algorithm, same determinism.
   */
  compact: { ...LAYERED, 'elk.layered.wrapping.strategy': 'MULTI_EDGE', 'elk.aspectRatio': '1.7' },

  /*
   * The wrapping traded away, and the crossing minimisation turned up.
   * Thoroughness is a search budget, so this ought to be the slow one and is
   * not: the wrapping compact does is more expensive than the search, and on
   * the demo estate this comes out at 341ms against compact's 633ms, holding
   * at roughly half the way up to 258 nodes. What it costs is height — every
   * layer in one run — which is the trade, because a wrapped layer puts two
   * things side by side that are nothing of the sort.
   */
  crossings: {
    ...LAYERED,
    'elk.layered.thoroughness': '40',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.semiInteractive': 'false',
    'elk.layered.nodePlacement.favorStraightEdges': 'true',
  },

  /* One box per team, each laid out inside itself and the boxes arranged among
     themselves — which is what SEPARATE_CHILDREN means and why it is here.
     Letting the layers run through the boxes instead (INCLUDE_CHILDREN) puts
     one team's nodes in four different layers and drags its box across the
     whole width: 3191x1156 for the demo estate against 1460x878 this way. The
     boxes are the point of this arrangement, so the boxes are what it packs. */
  teams: {
    ...LAYERED,
    'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
    'elk.layered.wrapping.strategy': 'MULTI_EDGE',
    'elk.aspectRatio': '1.7',
    'elk.spacing.nodeNode': '44',
    'elk.padding': '[top=34,left=18,bottom=18,right=18]',
  },
}

export type Position = { x: number; y: number }

/**
 * A group box, for the arrangements that have them. Positioned absolutely like
 * everything else rather than as a React Flow parent: a parent re-bases its
 * children's coordinates, which would fight both the saved hand-placed
 * positions and the drag that produces them.
 */
export type Group = { id: string; label: string; x: number; y: number; width: number; height: number }

export type Laid = { positions: Record<string, Position>; groups: Group[] }

/** The order the columns run in: what runs, what it serves, what it says, what it keeps. */
const COLUMN_ORDER: NodeKind[] = [
  'service',
  'endpoint',
  'kafka.topic',
  'contract',
  'database',
  'cache',
  'external',
]

/**
 * Roughly what the label needs, in the same 12px the node CSS renders at.
 * The height is the kind line plus the label plus the padding — one value for
 * every kind, because a row of nodes at different heights reads as meaning
 * something it does not.
 */
export function nodeSize(node: GraphNode): { width: number; height: number } {
  const chars = Math.max(node.name.length, 8)
  // A service's label is bold and so a little wider per character.
  const per = node.kind === 'service' ? 7.7 : 6.9
  return { width: Math.min(320, Math.max(120, Math.round(chars * per) + 34)), height: 46 }
}

/**
 * The key a layout is cached against: change the set of nodes or edges and the
 * layout is recomputed, move the mouse and it is not.
 *
 * The separator is a NUL because an endpoint id contains a space
 * (`api:wallet-service/GET /v1/wallets/{}`) and nothing else is safe. It is
 * written as an escape, not as the byte: a literal NUL in the source makes the
 * whole file binary to git, and this file stopped being diffable.
 */
export const layoutKey = (nodes: GraphNode[], edges: GraphEdge[], arrangement: Arrangement = 'compact') =>
  `${arrangement}|${nodes.map((n) => n.id).sort().join('\u0000')}|${edges.map((e) => e.id).sort().join('\u0000')}`

export async function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  arrangement: Arrangement = 'compact'
): Promise<Laid> {
  if (!nodes.length) return { positions: {}, groups: [] }
  if (arrangement === 'columns') return columns(nodes)

  const present = new Set(nodes.map((n) => n.id))
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
  // Laid out in the direction data flows, not the direction the edge is
  // stored in — a consumer belongs downstream of the topic it reads.
  /* Only node positions are read back from elk — React Flow draws the lines
     itself — so a second edge between a pair it has already been given is
     work with nothing to show for it. A service that owns a database and also
     writes to it is two scanned edges and one pull. */
  const paired = new Set<string>()
  const elkEdges = [...edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((e) => {
      const { source, target } = flowDirection(e)
      if (!present.has(source) || !present.has(target)) return []
      const pair = `${source}\u0000${target}`
      if (paired.has(pair)) return []
      paired.add(pair)
      return [{ id: e.id, sources: [source], targets: [target] }]
    })

  const graph =
    arrangement === 'teams'
      ? { id: 'root', layoutOptions: OPTIONS.teams, children: teamBoxes(sorted), edges: elkEdges }
      : {
          id: 'root',
          layoutOptions: OPTIONS[arrangement],
          children: sorted.map((n) => ({ id: n.id, ...nodeSize(n) })),
          edges: elkEdges,
        }

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      discardEngine()
      reject(
        Object.assign(
          new Error(
            `${sorted.length} nodes and ${elkEdges.length} lines did not lay out within ${LAYOUT_DEADLINE_SECONDS}s`
          ),
          { code: TOO_BIG, nodes: sorted.length, edges: elkEdges.length }
        )
      )
    }, DEADLINE_MS)
  })

  let laid: ElkNode
  try {
    laid = await Promise.race([elk().then((e) => e.layout(graph)), deadline])
  } catch (err) {
    /* A worker that has failed once is never asked again.
     *
     * elk is Java compiled to JavaScript and keeps module-level state, so a
     * run that threw — a stack overflow above all, which is how it fails on a
     * graph too dense for it — leaves that state half-finished. The next
     * layout on the same worker then dies somewhere unrelated and much harder
     * to read: reading a field off an undefined progress monitor, say, which
     * says nothing about the graph that actually caused it.
     *
     * The deadline already throws its worker away. This is the same rule for
     * the other way a layout ends: whatever went wrong, the next map gets a
     * worker that has never seen it. */
    discardEngine()
    throw err
  } finally {
    clearTimeout(timer)
  }
  const positions: Record<string, Position> = {}
  const groups: Group[] = []
  for (const child of laid.children ?? []) {
    if (!child.children?.length) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
      continue
    }
    // A group's children come back relative to it, so they are offset here and
    // nowhere else — every consumer of this file works in one coordinate space.
    groups.push({
      id: child.id,
      label: String((child as { labels?: { text: string }[] }).labels?.[0]?.text ?? child.id),
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    })
    for (const leaf of child.children) {
      positions[leaf.id] = { x: (child.x ?? 0) + (leaf.x ?? 0), y: (child.y ?? 0) + (leaf.y ?? 0) }
    }
  }
  return { positions, groups }
}

/** One elk group per team, in a fixed order so the boxes do not swap places. */
function teamBoxes(nodes: GraphNode[]) {
  const by = new Map<string, { label: string; nodes: GraphNode[] }>()
  for (const n of nodes) {
    const id = n.teamId ?? '\u00b7none'
    if (!by.has(id)) by.set(id, { label: n.teamName ?? n.teamId ?? 'No team', nodes: [] })
    by.get(id)!.nodes.push(n)
  }
  return [...by]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, group]) => ({
      id: `group:${id}`,
      labels: [{ text: group.label }],
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
      children: group.nodes.map((n) => ({ id: n.id, ...nodeSize(n) })),
    }))
}

/**
 * One column per kind, sorted by name, computed rather than laid out.
 *
 * elk would do this with partitions, but a column layout has no crossings to
 * minimise and no layers to assign — it is an ordering, and computing it
 * directly makes it instant, exactly reproducible and readable as arithmetic.
 */
function columns(nodes: GraphNode[]): Laid {
  const GAP_X = 90
  const GAP_Y = 14
  const HEAD = 34

  const by = new Map<NodeKind, GraphNode[]>()
  for (const n of nodes) {
    if (!by.has(n.kind)) by.set(n.kind, [])
    by.get(n.kind)!.push(n)
  }
  const present = COLUMN_ORDER.filter((k) => by.has(k))

  const positions: Record<string, Position> = {}
  const groups: Group[] = []
  let x = 0
  for (const kind of present) {
    const column = by.get(kind)!.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    const width = Math.max(...column.map((n) => nodeSize(n).width))
    let y = HEAD
    for (const n of column) {
      // Centred in the column, so a short name does not read as a ragged edge.
      positions[n.id] = { x: x + Math.round((width - nodeSize(n).width) / 2), y }
      y += nodeSize(n).height + GAP_Y
    }
    groups.push({
      id: `column:${kind}`,
      label: `${KIND_PLURAL[kind]} (${column.length})`,
      x: x - 14,
      y: 0,
      width: width + 28,
      height: y - GAP_Y + 14,
    })
    x += width + GAP_X
  }
  return { positions, groups }
}
