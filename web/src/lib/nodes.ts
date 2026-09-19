import type { EdgeKind, NodeKind } from './api'

/**
 * Fixed slot per node kind — never cycled, so a database is the same colour on
 * every screen. Values are token names from styles/theme.css.
 */
export const KIND_COLOR: Record<NodeKind, string> = {
  service: '--series-1',
  endpoint: '--series-2',
  'kafka.topic': '--series-3',
  database: '--series-4',
  cache: '--series-5',
  contract: '--series-7',
  external: '--text-muted',
}

/**
 * The eight categorical slots, in the order theme.css declares them. Node kind
 * already owns six of these, which is why a team cannot simply be another
 * colour: one encoding has to win, and the map's "Colour by" control is what
 * decides. See teamColours().
 */
const SERIES = [
  '--series-1', '--series-2', '--series-3', '--series-4',
  '--series-5', '--series-6', '--series-7', '--series-8',
] as const

/**
 * A colour per team, for the teams actually on screen. The tokens are
 * documented as "fixed order, never cycled", so past the eighth team there is
 * no colour left: those are drawn in the muted border colour and the legend
 * says so. Wrapping the palette round would put two teams in one colour with
 * nothing telling the reader.
 *
 * Sorted by id so a team keeps its colour between two loads of the same map.
 */
export function teamColours(teamIds: (string | null | undefined)[]): Map<string, string> {
  const ids = [...new Set(teamIds.filter((t): t is string => !!t))].sort()
  return new Map(ids.slice(0, SERIES.length).map((id, i) => [id, SERIES[i]]))
}

/** What a node with no team, or past the eighth, is drawn in. */
export const NO_TEAM_COLOR = '--text-muted'

export const KIND_LABEL: Record<NodeKind, string> = {
  service: 'Service',
  'kafka.topic': 'Kafka topic',
  database: 'Database',
  cache: 'Cache',
  endpoint: 'Endpoint',
  contract: 'Contract',
  external: 'External',
}

export const KIND_PLURAL: Record<NodeKind, string> = {
  service: 'Services',
  'kafka.topic': 'Topics',
  database: 'Databases',
  cache: 'Caches',
  endpoint: 'Endpoints',
  contract: 'Contracts',
  external: 'External systems',
}

export const EDGE_LABEL: Record<EdgeKind, string> = {
  'kafka.produce': 'Produces',
  'kafka.consume': 'Consumes',
  'db.read': 'Reads',
  'db.write': 'Writes',
  'db.owns': 'Owns',
  'cache.read': 'Reads cache',
  'cache.write': 'Writes cache',
  'http.call': 'Calls',
  'http.expose': 'Exposes',
  'depends.on': 'Depends on',
  'topic.schema': 'Carries',
}

/**
 * Stored direction is always service → other; these kinds flow the other way
 * and must be drawn reversed. Getting this wrong is the easiest mistake in the
 * codebase, so it lives in one place.
 */
const REVERSED = new Set<EdgeKind>(['kafka.consume', 'db.read', 'cache.read'])

export const flowDirection = (e: { from: string; to: string; kind: EdgeKind }) =>
  REVERSED.has(e.kind) ? { source: e.to, target: e.from } : { source: e.from, target: e.to }

/** Async relationships are dashed; bindings dotted; synchronous calls solid. */
export const edgeStyle = (kind: EdgeKind): 'solid' | 'dashed' | 'dotted' =>
  kind.startsWith('kafka.') ? 'dashed' : kind === 'depends.on' || kind === 'topic.schema' ? 'dotted' : 'solid'

/** The prefix half of an id — `topic:`, `svc:` — carries the kind. */
export const kindFromId = (id: string): NodeKind => {
  const prefix = id.split(':', 1)[0]
  return (
    {
      svc: 'service',
      topic: 'kafka.topic',
      db: 'database',
      cache: 'cache',
      api: 'endpoint',
      contract: 'contract',
      ext: 'external',
    } as Record<string, NodeKind>
  )[prefix] ?? 'external'
}

/** The readable half of an id, for labels: `topic:users.created.v2` → the topic. */
export const idValue = (id: string) => id.slice(id.indexOf(':') + 1)

export const nodeHref = (id: string) => `/node?id=${encodeURIComponent(id)}`

/** A code is `2.1.1` — full of dots, and never a path segment. */
export const processHref = (code: string) => `/process?code=${encodeURIComponent(code)}`

/** People write and say the prefix; only the storage drops it. */
/**
 * `2.1.1` → `L2.1.1`. Idempotent, because §1 accepts the prefix on input
 * everywhere — so a widget code typed as `L2.1` is a supported input, and used
 * to come back out of here as `LL2.1`.
 */
export const displayCode = (code: string) => (/^[Ll]/.test(code) ? `L${code.slice(1)}` : `L${code}`)

/** `/team?id=trading`. A team id is a query parameter, like every other id. */
export const teamHref = (id: string) => `/team?id=${encodeURIComponent(id)}`

/** How a process reached a team, in the reader's terms. */
export const REACH_LABEL: Record<string, string> = {
  owner: 'owns it',
  component: 'uses a component of theirs',
  handoff: 'hands off to or from them',
}

/**
 * EDGE_LABEL is written from the service's side — "Consumes", "Reads cache" —
 * which reads backwards once flowDirection() has put the topic or the store
 * first. These are the same relationships said the other way round.
 */
const FLOW_LABEL: Partial<Record<EdgeKind, string>> = {
  'kafka.consume': 'is consumed by',
  'db.read': 'is read by',
  'cache.read': 'is read by',
}

/** The verb for an edge drawn source → target in the direction data flows. */
export const flowVerb = (kind: EdgeKind) =>
  FLOW_LABEL[kind] ?? (EDGE_LABEL[kind] ?? kind).toLowerCase()

/** How a process's interaction reads left to right, in the flow direction. */
export function interactionLabel(edge: { from: string; kind: EdgeKind; to: string }) {
  const { source, target } = flowDirection(edge)
  return { source, target, verb: flowVerb(edge.kind) }
}

/** Provenance of a component on a process, most direct first. */
export const VIA_LABEL: Record<string, string> = {
  node: 'happens at',
  interaction: 'interacts with',
  touches: 'also uses',
  exposes: 'serves the endpoint',
  rollup: 'via a child',
}
