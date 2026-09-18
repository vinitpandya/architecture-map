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
export const displayCode = (code: string) => `L${code}`

/** How a process's interaction reads left to right, in the flow direction. */
export function interactionLabel(edge: { from: string; kind: EdgeKind; to: string }) {
  const { source, target } = flowDirection(edge)
  return { source, target, verb: EDGE_LABEL[edge.kind] ?? edge.kind }
}

/** Provenance of a component on a process, most direct first. */
export const VIA_LABEL: Record<string, string> = {
  node: 'happens at',
  interaction: 'interacts with',
  touches: 'also uses',
  exposes: 'serves the endpoint',
  rollup: 'via a child',
}
