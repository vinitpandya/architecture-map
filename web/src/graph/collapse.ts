import type { GraphData, GraphEdge } from '../lib/api'

/* ─────────────────────────────────────── the service-level view

   The estate has no service → service edges. Everything runs through
   something: A publishes a topic B consumes, A calls an endpoint B serves, A
   writes a store B reads. That is the right shape for the data — it is what
   the scan found, and the intermediary is the thing that actually breaks — but
   it means a map of forty services is a map of two hundred nodes.

   So this collapses the intermediary into a line and keeps what carried it, so
   a click can still say which topic. It is derived for display only: nothing
   here is stored, and the full view is one control away.
*/

/** What kind of relationship a derived line stands for. */
export type Relation = 'event' | 'call' | 'store'

export const RELATION_LABEL: Record<Relation, string> = {
  event: 'Events',
  call: 'Calls',
  store: 'Shared stores',
}

/**
 * Drawn differently on purpose. A shared store is not a conversation — nobody
 * chose it as an interface — and it is the coupling that surprises people, so
 * it should not look like a call.
 */
export const RELATION_STYLE: Record<Relation, 'solid' | 'dashed' | 'dotted'> = {
  event: 'dashed',
  call: 'solid',
  store: 'dotted',
}

/**
 * Each derived line takes the colour of the kind it swallowed — a topic's for
 * an event, an endpoint's for a call, a database's for a store — so switching
 * between the two detail levels does not recolour the estate.
 */
export const RELATION_COLOR: Record<Relation, string> = {
  event: '--series-3',
  call: '--series-2',
  store: '--series-4',
}

/**
 * A derived line, with what it stands for kept on it. `through` is empty for
 * an external, which is drawn as itself — there was nothing to collapse.
 */
export type ServiceEdge = GraphEdge & {
  relation: Relation
  /** The topics, endpoints or stores this line stands for, and their kinds. */
  through: { id: string; kind: string }[]
}

const OUT: Record<Relation, string[]> = {
  event: ['kafka.produce'],
  call: ['http.call'],
  store: ['db.write', 'db.owns', 'cache.write'],
}
const IN: Record<Relation, string[]> = {
  event: ['kafka.consume'],
  call: ['http.expose'],
  store: ['db.read', 'cache.read'],
}

export const RELATIONS: Relation[] = ['event', 'call', 'store']

/**
 * Where collapsing stops telling the truth.
 *
 * Collapsing an intermediary asserts a line per producer per consumer, and
 * that is right for the shape most of them have: one service publishes, a
 * handful listen. It is wrong for the ones every estate grows — an audit
 * topic, an outbox, a shared database — where both sides are plural and the
 * expansion claims a conversation between every pair. Eight producers and
 * eight consumers is sixteen services sharing a bus, not sixty-four
 * relationships, and drawing it as sixty-four is a lie that also happens to
 * be unreadable.
 *
 * So past this many lines the intermediary is kept as itself and the scan's
 * own edges are drawn to it: p + c lines instead of p x c, none of them
 * invented. Measured on the demo estate the largest expansion is four, so
 * nothing there crosses this — it exists for the real one.
 */
const HUB_LINES = 12

/** `depends.on` and `topic.schema` are bindings, not traffic, and are dropped:
 *  every service depends on nearly every contract, so collapsing them draws a
 *  line from everything to everything and says nothing. */
const relationOf = (kind: string): Relation | null =>
  RELATIONS.find((r) => OUT[r].includes(kind) || IN[r].includes(kind)) ?? null

/** Whether a line on the map is one of these derived ones rather than a scanned edge. */
export const isDerived = (e: GraphEdge): e is ServiceEdge => 'relation' in e

/**
 * Services and externals, with one line per pair per relation.
 *
 * Externals stay as nodes of their own rather than collapsing: a call to
 * Stripe has nothing on the far side to collapse INTO, and "who do we depend
 * on outside" is one of the questions this view is for.
 */
export function collapseToServices(data: GraphData): GraphData & { edges: ServiceEdge[] } {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const isService = (id: string) => byId.get(id)?.kind === 'service'
  const isExternal = (id: string) => byId.get(id)?.kind === 'external'

  // Which services sit on each end of each intermediary, per relation.
  const producers = new Map<string, Map<Relation, Set<string>>>()
  const consumers = new Map<string, Map<Relation, Set<string>>>()
  const bag = (m: Map<string, Map<Relation, Set<string>>>, mid: string, rel: Relation) => {
    if (!m.has(mid)) m.set(mid, new Map())
    const r = m.get(mid)!
    if (!r.has(rel)) r.set(rel, new Set())
    return r.get(rel)!
  }

  const direct: ServiceEdge[] = []

  for (const e of data.edges) {
    // A service talking to something outside the estate has no far side to
    // collapse into, so it survives as itself.
    if (isService(e.from) && isExternal(e.to)) {
      direct.push({ ...e, relation: relationOf(e.kind) ?? 'call', through: [] })
      continue
    }
    if (!isService(e.from)) continue
    for (const rel of RELATIONS) {
      if (OUT[rel].includes(e.kind)) bag(producers, e.to, rel).add(e.from)
      if (IN[rel].includes(e.kind)) bag(consumers, e.to, rel).add(e.from)
    }
  }

  /* Which intermediaries are too busy to collapse. Decided per node rather
     than per relation: a topic drawn as itself for its events and collapsed
     away for its stores would be half on the map. */
  const hubs = new Set<string>()
  for (const [mid, byRel] of producers) {
    if (isService(mid) || isExternal(mid)) continue
    for (const [rel, from] of byRel) {
      const to = consumers.get(mid)?.get(rel)
      if (!to) continue
      if (from.size > 1 && to.size > 1 && from.size * to.size > HUB_LINES) hubs.add(mid)
    }
  }

  const keep = data.nodes.filter(
    (n) => n.kind === 'service' || n.kind === 'external' || hubs.has(n.id)
  )
  const kept = new Set(keep.map((n) => n.id))

  // One line per (from, to, relation), listing everything it stands for.
  const lines = new Map<string, ServiceEdge>()
  for (const [mid, byRel] of producers) {
    if (hubs.has(mid)) continue
    for (const [rel, from] of byRel) {
      for (const to of consumers.get(mid)?.get(rel) ?? []) {
        if (!from.size) continue
        for (const a of from) {
          if (a === to) continue
          if (!kept.has(a) || !kept.has(to)) continue
          const id = `${a}|${rel}|${to}`
          const prior = lines.get(id)
          const through = { id: mid, kind: byId.get(mid)?.kind ?? 'unknown' }
          if (prior) {
            if (!prior.through.some((t) => t.id === mid)) prior.through.push(through)
            continue
          }
          lines.set(id, {
            id,
            from: a,
            to,
            // `kind` is what the rest of the map styles on; the real
            // relationship is in `relation`.
            kind: rel === 'event' ? 'kafka.produce' : rel === 'store' ? 'db.write' : 'http.call',
            contractId: null,
            description: null,
            confidence: 'high',
            repo: '',
            relation: rel,
            through: [through],
          })
        }
      }
    }
  }

  /* A hub is on the map as itself, so what reaches it is the scan's own
     edges — a real kind, a real confidence, a real repo — rather than
     anything derived. `through` is empty for the same reason it is empty for
     an external: nothing was collapsed into this line. */
  const spokes: ServiceEdge[] = []
  for (const e of hubs.size ? data.edges : []) {
    if (!hubs.has(e.from) && !hubs.has(e.to)) continue
    if (!kept.has(e.from) || !kept.has(e.to)) continue
    const rel = relationOf(e.kind)
    if (!rel) continue
    spokes.push({ ...e, relation: rel, through: [] })
  }

  // A service nothing connects to is still part of the estate and still worth
  // seeing — an island is a finding, not a rendering accident — so every
  // service and external is kept whether or not a line reached it.
  return { ...data, nodes: keep, edges: [...direct, ...lines.values(), ...spokes] }
}
