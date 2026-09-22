import { db } from './db.js'
import { linkId, sha1 } from './ids.js'
import { aliasMap, canonicalTeam, rebuildTeams, registryConfigured } from './teams.js'

/**
 * The link pass. Entirely deterministic — no LLM, no heuristic merging, no
 * auto-correction of anything. It runs after every ingest because ownership
 * and drift are only true across the whole estate: one repo's manifest cannot
 * know whether anybody else produces the topic it consumes.
 *
 * It rebuilds `drift` from scratch each time and never touches `overrides`.
 */

/** Which edge kinds constitute a claim of ownership over their target. */
const OWNING = ['db.owns', 'http.expose', 'kafka.produce']

/**
 * Of those, the ones that are exclusive. Two repos holding migrations for one
 * database, or two services serving one route, is a mistake worth reporting.
 * Two services producing to one topic is ordinary fan-in, and flagging it
 * would train people to ignore the finding.
 */
const EXCLUSIVE = new Set(['db.owns', 'http.expose'])

const PREFIX_KIND = {
  svc: 'service',
  topic: 'kafka.topic',
  db: 'database',
  cache: 'cache',
  api: 'endpoint',
  contract: 'contract',
  ext: 'external',
}

const idValue = (id) => id.slice(id.indexOf(':') + 1)

/** How an edge kind reads in a sentence, for findings people have to act on. */
const EDGE_PHRASE = {
  'kafka.produce': 'publishes to',
  'kafka.consume': 'consumes',
  'db.read': 'reads',
  'db.write': 'writes',
  'db.owns': 'owns',
  'cache.read': 'reads from the cache',
  'cache.write': 'writes to the cache',
  'http.call': 'calls',
  'http.expose': 'serves',
  'depends.on': 'depends on',
  'topic.schema': 'carries',
}

/** `a`, `a and b`, `a, b and c` — these strings are read by people. */
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * Two ids are a near miss when they collapse to the same string: case and
 * separators removed. `users.created.v2` and `UsersCreatedV2` are almost
 * certainly the same topic spelt twice, and still collapse together here.
 *
 * The version suffix is deliberately NOT stripped. Doing so made
 * `orders.matched.v1` and `orders.matched.v2` normalise alike and reported
 * them as one topic spelt two ways — which is not a typo, it is a migration,
 * and it is the single most consequential thing an event-driven estate does.
 * Telling somebody their v2 rollout is a spelling mistake is worse than
 * saying nothing: both versions are real nodes and both are on the map.
 */
export const normaliseId = (id) => idValue(id).toLowerCase().replace(/[._-]/g, '')

export function linkPass(now = new Date().toISOString()) {
  run(now)
}

const run = db.transaction((now) => {
  createOrphans(now)
  resolveOwnership()
  // Layer C before Layer B's rollup reads it: the registry first, then the
  // team on every component, because a process's reach is computed from it.
  rebuildTeams()
  resolveTeams()
  // Layer B before the findings: a manifest landing today can resolve a
  // process that did not resolve yesterday, and the findings have to see that.
  resolveInteractions()
  rebuildProcessRollup()
  // After the rollup: a handoff's support is decided by whether the two
  // processes share a component, and that is what the rollup has just
  // established.
  rebuildProcessLinks(now)
  rebuildProcessNext()
  rebuildProcessTeams()
  rebuildDrift(now)
})

/* ──────────────────────────────────────────── layer C: whose is it

   A team is an attribute of the things on the map, never a member of it: the
   estate holds facts found in code, and who is accountable for a service is an
   org fact. So nothing here writes to `nodes` except the one derived column,
   and nothing here creates a node.
*/

/**
 * `nodes.team_id`, first match wins:
 *
 *   1. its own, for a service whose manifest named a team — and an override
 *      beats the manifest, because a human correction outranks a scan;
 *   2. its owner's, which is what gives topics, stores and endpoints a team
 *      without anybody authoring one;
 *   3. its single writer's, which is what gives a cache one, since `db.owns`
 *      has no cache equivalent. Exactly one writer: two and it stays teamless,
 *      because guessing between them is worse than saying nothing.
 *
 * Anything else is legitimately teamless. An external is somebody else's by
 * definition, a contract is a payload rather than a thing a team runs, and a
 * topic nobody produces has no owner to inherit from.
 */
function resolveTeams() {
  db.prepare('UPDATE nodes SET team_id = NULL').run()

  // Everything below reads a team *out of the data* — a manifest's
  // `service.team`, a pack's `owner`, a human's override — so everything below
  // goes through the registry's aliases. A merge that held on the Teams page
  // and nowhere else would be no merge at all. Read once: this is asked per
  // node and per process.
  const aliases = aliasMap()

  // A human correction outranks the scan, per SPEC.md §15.4.
  const overridden = new Map(
    db
      .prepare(`SELECT subject_id, value FROM overrides WHERE subject_kind = 'node' AND field = 'team'`)
      .all()
      .map((r) => [r.subject_id, r.value])
  )

  // Off the active manifest's body, not off `nodes.team`. The node upsert is
  // COALESCE-based, so a column never clears: a service whose next manifest
  // drops `service.team` would keep the old one for ever, and
  // `component-no-team` could never fire for a service that once had one. The
  // manifest is the evidence, so the manifest is what is read — the same
  // pattern `touches` and `handsOffTo` already use.
  const declaredTeam = new Map()
  for (const row of db
    .prepare(`SELECT service_id, raw FROM manifests WHERE status = 'active' AND service_id IS NOT NULL`)
    .all()) {
    let parsed = null
    try {
      parsed = JSON.parse(row.raw)
    } catch {
      continue
    }
    const raw = parsed?.service?.team
    if (raw) declaredTeam.set(row.service_id, raw)
  }

  const teamOfService = new Map()
  for (const n of db.prepare(`SELECT id FROM nodes WHERE kind = 'service'`).all()) {
    const id = canonicalTeam(overridden.get(n.id) ?? declaredTeam.get(n.id), aliases)
    if (id) teamOfService.set(n.id, id)
  }

  // A repo's team is its service's. `owner_repo` is a repo name; the service
  // it belongs to is the one whose manifest declared it.
  const teamOfRepo = new Map()
  for (const r of db
    .prepare(`SELECT m.repo, m.service_id FROM manifests m WHERE m.status = 'active' AND m.service_id IS NOT NULL`)
    .all()) {
    const t = teamOfService.get(r.service_id)
    if (t) teamOfRepo.set(r.repo, t)
  }

  // Exactly one writing TEAM, for the nodes no `owns` edge covers — not one
  // writing service, so two services of one team writing a cache still
  // resolves. Two teams and it stays teamless.
  const writerTeams = new Map()
  for (const e of db
    .prepare(`SELECT from_id, to_id FROM edges WHERE kind IN ('db.write', 'cache.write')`)
    .all()) {
    const t = teamOfService.get(e.from_id)
    if (!t) continue
    if (!writerTeams.has(e.to_id)) writerTeams.set(e.to_id, new Set())
    writerTeams.get(e.to_id).add(t)
  }

  /* The teams behind a node's ownership claims.

     `owner_repo` is decided by first-claim-by-first_seen with the repo name as
     a tiebreak, and DECISIONS.md adopted that rule precisely because fan-in
     onto a topic "is not a defect" — the winner was never meant to mean
     anything. Reading it as "this team owns this topic" would promote an
     ingest-order tiebreak into an org fact, colour the node, and decide which
     team's filter it appears under. So the same "exactly one" discipline rule 3
     uses applies here: one distinct team behind the claims or none at all. */
  const claimTeams = new Map()
  for (const e of db
    .prepare(`SELECT from_id, to_id FROM edges WHERE kind IN ('db.owns', 'http.expose', 'kafka.produce')`)
    .all()) {
    const t = teamOfService.get(e.from_id)
    if (!t) continue
    if (!claimTeams.has(e.to_id)) claimTeams.set(e.to_id, new Set())
    claimTeams.get(e.to_id).add(t)
  }
  const only = (set) => (set && set.size === 1 ? [...set][0] : null)

  const set = db.prepare('UPDATE nodes SET team_id = ? WHERE id = ?')
  for (const n of db.prepare('SELECT id, kind FROM nodes').all()) {
    let id = null
    if (n.kind === 'service') {
      id = teamOfService.get(n.id) ?? null
    } else {
      id = canonicalTeam(overridden.get(n.id), aliases) || only(claimTeams.get(n.id)) || only(writerTeams.get(n.id))
    }
    if (id) set.run(id, n.id)
  }

  /* A process's team is its own owner, else the nearest ancestor's.

     A leaf inside a stage owned by trading is trading unless it says
     otherwise, which is what a reader assumes. Without the inheritance a
     teamless leaf drops out of every team view and poisons `cross_team` on
     every handoff it takes part in — while `process-no-owner` deliberately
     does not fire for a leaf, so nothing would ever say why. */
  db.prepare(`UPDATE processes SET team_id = NULL, team_via = NULL`).run()
  const setProc = db.prepare('UPDATE processes SET team_id = ?, team_via = ? WHERE id = ?')
  const procs = db.prepare('SELECT id, code, owner FROM processes ORDER BY sort_key').all()
  const own = new Map(procs.map((p) => [p.id, canonicalTeam(p.owner, aliases) || null]))
  for (const p of procs) {
    if (own.get(p.id)) {
      setProc.run(own.get(p.id), 'owner', p.id)
      continue
    }
    // Nearest first, so a level 3 prefers its stage over its level 1.
    for (const a of ancestorsOf(p.code).reverse()) {
      if (own.get(a)) {
        setProc.run(own.get(a), 'inherited', p.id)
        break
      }
    }
  }

  // A team the data mentions and the registry does not still gets a row, so
  // every screen can name it. Run again because resolveTeams() is what first
  // establishes which ids are actually in use.
  rebuildTeams()
}

/* ─────────────────────────────────────────── layer B: process rollup

   Rebuilt whole on every pass, from the processes and the topology, and never
   authored. A parent's components are its children's; nothing writes them by
   hand, and nothing here writes to `nodes` or `edges` — a process pack reads
   topology and reports what it cannot find.
*/

/** Most direct provenance wins when two paths reach the same component. */
const VIA_RANK = { node: 0, interaction: 1, touches: 2, exposes: 3, rollup: 4 }

/**
 * An interaction resolves by its three parts, not by re-hashing them: an
 * edge's id IS sha1(from|kind|to), so the row carrying those three values is
 * by construction the one the author described. Re-run every pass, because
 * whether that edge exists is a fact about the topology and the topology moves.
 */
function resolveInteractions() {
  db.prepare(
    `UPDATE processes SET edge_id = (
       SELECT e.id FROM edges e
       WHERE e.from_id = processes.edge_from
         AND e.kind    = processes.edge_kind
         AND e.to_id   = processes.edge_to
     ) WHERE edge_from IS NOT NULL`
  ).run()
  db.prepare('UPDATE processes SET edge_id = NULL WHERE edge_from IS NULL').run()
}

/**
 * `touches` is a set per process, read only here, so it is taken back off the
 * pack's raw body rather than denormalised into a table nothing else would
 * use. Also yields which pack declared which code, for the duplicate finding —
 * the `processes` row can only hold the last writer.
 */
function fromActivePacks() {
  const touches = new Map()
  const owners = new Map()
  const declared = new Map()
  const branches = new Map()
  for (const row of db.prepare(`SELECT pack, raw FROM process_packs WHERE status = 'active'`).all()) {
    let parsed = null
    try {
      parsed = JSON.parse(row.raw)
    } catch {
      continue
    }
    for (const p of parsed.processes ?? []) {
      const code = String(p.code ?? '').trim().replace(/^[Ll]/, '')
      const id = `proc:${code}`
      // Counted rather than set-collected: a pack that declares one code twice
      // silently loses a process, and that is the same error as two packs
      // colliding — the row can only hold the last writer either way.
      if (!owners.has(code)) owners.set(code, new Map())
      const claims = owners.get(code)
      claims.set(row.pack, (claims.get(row.pack) ?? 0) + 1)
      // Declared handoffs, read back off the raw body for the same reason
      // `touches` is: only the link pass consumes them, and a column nothing
      // else would ever read is not worth the schema.
      for (const h of p.handsOffTo ?? []) {
        const to = String(h?.process ?? '').trim().replace(/^[Ll]/, '')
        if (!to) continue
        if (!declared.has(id)) declared.set(id, new Map())
        declared.get(id).set(`proc:${to}`, h?.note ?? null)
      }

      // Where the flow goes next, for the same reason and off the same body.
      // Kept as a list rather than a map: two branches of one decision can
      // lead to the same place under different conditions, and the order they
      // were written in is the order they are drawn.
      if (p.next?.length) {
        branches.set(
          id,
          p.next.map((b) => ({
            when: typeof b?.when === 'string' && b.when.trim() ? b.when.trim() : null,
            to: b?.process ? `proc:${String(b.process).trim().replace(/^[Ll]/, '')}` : null,
            end: typeof b?.end === 'string' && b.end.trim() ? b.end.trim() : null,
          })).filter((b) => b.to || b.end)
        )
      }

      if (!p.touches?.length) continue
      if (!touches.has(id)) touches.set(id, new Set())
      for (const nodeId of p.touches) touches.get(id).add(nodeId)
    }
  }
  return { touches, owners, declared, branches }
}

/**
 * `process_next`, resolved against the processes that exist.
 *
 * A branch naming a code nobody has written is kept with `resolved = 0` rather
 * than dropped, and reported — SPEC-PROCESSES §12.1 applied once more: a pack
 * may not bring a process into existence, and "our error path goes to a
 * process that is not on the map" is worth knowing.
 */
function rebuildProcessNext() {
  db.prepare('DELETE FROM process_next').run()
  const known = new Set(db.prepare('SELECT id FROM processes').all().map((r) => r.id))
  if (!known.size) return

  const { branches } = fromActivePacks()
  const ins = db.prepare(
    `INSERT OR REPLACE INTO process_next (from_id, seq, condition, to_id, resolved, end_label)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const [from, list] of branches) {
    // A branch on a process the pack never declared has nothing to be a branch
    // of. That is the duplicate-code case rather than a new one, and the row
    // would be unreachable from every screen.
    if (!known.has(from)) continue
    list.forEach((b, i) => {
      // A branch to itself is the one loop that is never what anybody meant.
      if (b.to === from) return
      ins.run(from, i, b.when, b.to, b.to && known.has(b.to) ? 1 : 0, b.end)
    })
  }
}

function rebuildProcessRollup() {
  db.prepare('DELETE FROM process_components').run()
  db.prepare('DELETE FROM process_edges').run()

  const procs = db.prepare('SELECT * FROM processes ORDER BY sort_key').all()
  if (!procs.length) return

  const { touches } = fromActivePacks()
  const kindOf = new Map(db.prepare('SELECT id, kind FROM nodes').all().map((n) => [n.id, n.kind]))
  // Every exposer, not the last one written. Two services exposing one route is
  // a topology Layer A already models and reports as `multiple-owners`, and
  // collapsing the map on `to_id` meant the rollup kept whichever edge row the
  // scan returned last — so a process could lose the service that actually
  // serves the endpoint it calls, and gain a false `uncovered-component`, on
  // nothing but the order the manifests were ingested in. §5's rule stops at
  // endpoints on purpose; it never said to pick one of them.
  const exposedBy = new Map()
  for (const e of db.prepare(`SELECT to_id, from_id FROM edges WHERE kind = 'http.expose'`).all()) {
    if (!exposedBy.has(e.to_id)) exposedBy.set(e.to_id, [])
    exposedBy.get(e.to_id).push(e.from_id)
  }

  const comps = new Map()
  const edges = new Map()
  const bag = (map, key) => {
    if (!map.has(key)) map.set(key, new Map())
    return map.get(key)
  }
  /** A component a pack named but the map does not have is a finding, not a
   *  row in the join — the join is what the two layers agree on. */
  const addComp = (pid, nodeId, via) => {
    if (!nodeId || !kindOf.has(nodeId)) return
    const b = bag(comps, pid)
    if (!b.has(nodeId) || VIA_RANK[via] < VIA_RANK[b.get(nodeId)]) b.set(nodeId, via)
  }
  const addEdge = (pid, edgeId, via) => {
    if (!edgeId) return
    const b = bag(edges, pid)
    if (!b.has(edgeId) || VIA_RANK[via] < VIA_RANK[b.get(edgeId)]) b.set(edgeId, via)
  }

  // 1 · what each process names for itself
  for (const p of procs) {
    addComp(p.id, p.node_id, 'node')
    if (p.edge_id) {
      addComp(p.id, p.edge_from, 'interaction')
      addComp(p.id, p.edge_to, 'interaction')
      addEdge(p.id, p.edge_id, 'interaction')
    }
    for (const t of touches.get(p.id) ?? []) addComp(p.id, t, 'touches')
  }

  // 2 · an endpoint is served by somebody. Without this a process that calls
  // api:pricing-service/GET /v1/rates/{} would never register as using
  // pricing-service, and "which processes use this service" would be wrong.
  // It stops here on purpose: a process on a topic does NOT thereby touch
  // everything else on that topic, or every process would touch everything.
  for (const p of procs) {
    // Snapshotted, because addComp writes into the map being read.
    for (const nodeId of [...bag(comps, p.id).keys()]) {
      if (kindOf.get(nodeId) !== 'endpoint') continue
      for (const service of exposedBy.get(nodeId) ?? []) addComp(p.id, service, 'exposes')
    }
  }

  // 3 · upward, deepest first, so a level 3's components reach the level 1.
  // A parent that does not exist gets nothing: an orphan code (3.4.1 with no
  // 3.4) is a finding, and rolling into a phantom id would put rows in the
  // join for a process no page can open.
  const real = new Set(procs.map((p) => p.id))
  for (const p of [...procs].sort((a, b) => b.level - a.level)) {
    if (!p.parent_id || !real.has(p.parent_id)) continue
    for (const nodeId of [...bag(comps, p.id).keys()]) addComp(p.parent_id, nodeId, 'rollup')
    for (const edgeId of [...bag(edges, p.id).keys()]) addEdge(p.parent_id, edgeId, 'rollup')
  }

  const insComp = db.prepare('INSERT INTO process_components (process_id, node_id, via) VALUES (?, ?, ?)')
  const insEdge = db.prepare('INSERT INTO process_edges (process_id, edge_id, via) VALUES (?, ?, ?)')
  for (const [pid, b] of comps) for (const [nodeId, via] of b) insComp.run(pid, nodeId, via)
  for (const [pid, b] of edges) for (const [edgeId, via] of b) insEdge.run(pid, edgeId, via)
}

/* ──────────────────────────────────────── layer C: handoffs between processes

   A handoff is the point where one team's work ends and another's begins. The
   whole design turns on one distinction, and it is easy to get backwards:

   **A synchronous call is not a handoff.** When trading calls the user lookup,
   trading's process does not end and identity's does not begin — trading's
   process continues, holding a response. Deriving a handoff from an http.call
   produces twenty-five links on the demo estate and every one is nonsense,
   because nothing in the data says which process, if any, serves a lookup:
   across all 46 demo processes not one names an endpoint as its node and not
   one has an http.expose interaction. Packs document the calling side.

   **An event is.** A publish and a consume are two halves of exactly the thing
   this layer names, written by two teams who did not coordinate. That is the
   only relation derived here. Everything else is a dependency on a team rather
   than a handoff to a process, and `process_teams` is where it lives.
*/

/** kafka beats component beats none, when two links roll into one. */
const SUPPORT_RANK = { kafka: 0, component: 1, none: 2 }

/** Every strict ancestor of a code, deepest last: 2.3.1 → [proc:2, proc:2.3]. */
function ancestorsOf(code) {
  const parts = String(code).split('.')
  return parts.slice(0, -1).map((_, i) => `proc:${parts.slice(0, i + 1).join('.')}`)
}

function rebuildProcessLinks(now) {
  // first_seen survives the rebuild, so "since when have we handed off to
  // them" stays true — the same promise edges.first_seen makes.
  const wasSeen = new Map(
    db.prepare('SELECT id, first_seen FROM process_links').all().map((r) => [r.id, r.first_seen])
  )
  db.prepare('DELETE FROM process_links').run()

  const procs = db.prepare('SELECT * FROM processes').all()
  if (!procs.length) return
  const byId = new Map(procs.map((p) => [p.id, p]))

  const { touches, declared } = fromActivePacks()

  /* ---- 1 · derived, Kafka only, and checked against the topology.

     The publish side is a process whose interaction is a resolved
     `kafka.produce`. The consume side is a process that either says so in its
     interaction, OR names the topic in `touches` while the topology contains
     the consuming edge.

     That second clause is not a loosening: SPEC-PROCESSES §3 blesses a leaf
     spending its one interaction slot on what it does with the message and
     naming the topic in `touches`, and reading only the interaction made the
     answer depend on which of two equally true facts the author wrote where.
     On the demo estate it is the difference between six handoffs and eight —
     the trading→ledger and identity→wallet ones were being lost. The topology
     check is what keeps it a fact: `2.3.4` also names orders.matched.v1 in
     `touches` and has no consuming edge, so it produces no handoff. */
  const consumeEdge = db.prepare(
    `SELECT id FROM edges WHERE from_id = ? AND kind = 'kafka.consume' AND to_id = ?`
  )

  const producers = new Map()
  const consumers = new Map()
  for (const p of procs) {
    if (p.edge_kind === 'kafka.produce' && p.edge_to && p.edge_id) {
      if (!producers.has(p.edge_to)) producers.set(p.edge_to, [])
      producers.get(p.edge_to).push({ proc: p, edgeId: p.edge_id })
    }
    if (p.edge_kind === 'kafka.consume' && p.edge_to && p.edge_id) {
      if (!consumers.has(p.edge_to)) consumers.set(p.edge_to, [])
      consumers.get(p.edge_to).push({ proc: p, edgeId: p.edge_id })
    }
    for (const t of touches.get(p.id) ?? []) {
      if (!String(t).startsWith('topic:') || !p.node_id) continue
      if (p.edge_kind === 'kafka.consume' && p.edge_to === t) continue
      const e = consumeEdge.get(p.node_id, t)
      if (!e) continue
      if (!consumers.has(t)) consumers.set(t, [])
      consumers.get(t).push({ proc: p, edgeId: e.id })
    }
  }

  /* Keyed by row id so a pair reached twice merges rather than colliding on
     the primary key. `from_team_id`/`to_team_id` are the LEAF pair's teams and
     travel unchanged into every rollup of the row: a rolled-up row's own ends
     are ancestors, whose owners are frequently different teams from the
     children doing the work, and reading the row's ends would put a pair in
     the team matrix that never happened. */
  const rows = new Map()
  const put = (from, to, kind, viaNode, via, patch) => {
    const id = linkId(from, kind, to, viaNode)
    const prior = rows.get(id)
    if (!prior) {
      rows.set(id, {
        id,
        from_id: from,
        to_id: to,
        kind,
        via_node: viaNode ?? null,
        via,
        declared: 0,
        derived: 0,
        support: 'none',
        from_team_id: null,
        to_team_id: null,
        from_edge_id: null,
        to_edge_id: null,
        note: null,
        ...patch,
      })
      return rows.get(id)
    }
    prior.declared = prior.declared || patch.declared || 0
    prior.derived = prior.derived || patch.derived || 0
    if (SUPPORT_RANK[patch.support ?? 'none'] < SUPPORT_RANK[prior.support]) prior.support = patch.support
    // 'interaction' outranks 'rollup': a direct handoff is not a rolled-up one.
    if (patch.via === 'interaction') prior.via = 'interaction'
    if (!prior.note && patch.note) prior.note = patch.note
    for (const k of ['from_team_id', 'to_team_id', 'from_edge_id', 'to_edge_id']) {
      if (!prior[k] && patch[k]) prior[k] = patch[k]
    }
    return prior
  }

  for (const [topic, from] of producers) {
    for (const a of from) {
      for (const b of consumers.get(topic) ?? []) {
        if (a.proc.id === b.proc.id) continue
        put(a.proc.id, b.proc.id, 'kafka', topic, 'interaction', {
          derived: 1,
          support: 'kafka',
          from_team_id: a.proc.team_id ?? null,
          to_team_id: b.proc.team_id ?? null,
          from_edge_id: a.edgeId,
          to_edge_id: b.edgeId,
        })
      }
    }
  }

  /* ---- 2 · rollup of the derived rows, before the declarations are matched.

     A handoff between two leaves is one between their ancestors too — except
     where the two ends are the same process or one contains the other, or an
     internal handoff inside L2 would roll up into "L2 hands off to L2".

     Rolling up first is what lets a declaration written at ANY level find its
     derived counterpart: a pair is agreed or it is not, and agreement is a
     property of the pair rather than of whichever row happened to exist when
     the declaration was read. */
  const rollUp = () => {
    for (const r of [...rows.values()]) {
      if (r.via === 'rollup') continue
      const froms = [r.from_id, ...ancestorsOf(byId.get(r.from_id).code)]
      const tos = [r.to_id, ...ancestorsOf(byId.get(r.to_id).code)]
      for (const f of froms) {
        for (const t of tos) {
          if (f === r.from_id && t === r.to_id) continue
          if (f === t) continue
          if (!byId.has(f) || !byId.has(t)) continue
          const fc = byId.get(f).code
          const tc = byId.get(t).code
          if (fc.startsWith(`${tc}.`) || tc.startsWith(`${fc}.`)) continue
          put(f, t, r.kind, r.via_node, 'rollup', {
            declared: r.declared,
            derived: r.derived,
            support: r.support,
            from_team_id: r.from_team_id,
            to_team_id: r.to_team_id,
            note: null,
          })
        }
      }
    }
  }
  rollUp()

  /* ---- 3 · declared.

     Agreement is a property of the pair: every derived row for (from, to) is
     marked, at whatever level the declaration was written. A kind='declared'
     row is only written when the topology has nothing for that pair at all. */
  const derivedPairs = new Map()
  for (const r of rows.values()) {
    if (!r.derived) continue
    const key = `${r.from_id}|${r.to_id}`
    if (!derivedPairs.has(key)) derivedPairs.set(key, [])
    derivedPairs.get(key).push(r)
  }

  /* ---- 4 · support.

     Over DIRECT components only. `process_components` rolls up, so an L1's set
     is its whole subtree's and almost any two of them intersect — on the demo
     estate every ordered pair of level 1s shares something, which would make
     `process-link-unsupported` dead above level 3, exactly where a declared
     handoff between two big processes is most likely to be stale. */
  const directOf = new Map()
  for (const r of db
    .prepare(`SELECT process_id, node_id FROM process_components WHERE via <> 'rollup'`)
    .all()) {
    if (!directOf.has(r.process_id)) directOf.set(r.process_id, new Set())
    directOf.get(r.process_id).add(r.node_id)
  }
  const share = (a, b) => {
    const x = directOf.get(a)
    const y = directOf.get(b)
    if (!x || !y) return false
    for (const id of x) if (y.has(id)) return true
    return false
  }

  const fresh = []
  for (const [from, targets] of declared) {
    if (!byId.has(from)) continue
    for (const [to, note] of targets) {
      if (from === to) continue
      if (!byId.has(to)) continue // a finding, not a row — see handoffFindings()
      const agreed = derivedPairs.get(`${from}|${to}`)
      if (agreed?.length) {
        for (const r of agreed) {
          r.declared = 1
          if (!r.note && note) r.note = note
        }
        continue
      }
      fresh.push(
        put(from, to, 'declared', null, 'interaction', {
          declared: 1,
          support: share(from, to) ? 'component' : 'none',
          from_team_id: byId.get(from).team_id ?? null,
          to_team_id: byId.get(to).team_id ?? null,
          note,
        })
      )
    }
  }
  // Roll the declared-only rows up too, now that they exist.
  if (fresh.length) rollUp()

  /* ---- 5 · cross_team, off the carried leaf teams.

     Both ends must have a team. A link with a teamless end is not cross-team;
     it is unknown, and calling it a boundary would let a missing owner
     masquerade as one. With the inheritance in resolveTeams() that is rare,
     and when it happens `process-no-owner` reports it at the level that
     matters. */
  const ins = db.prepare(
    `INSERT INTO process_links
       (id, from_id, to_id, kind, via_node, via, declared, derived, support,
        from_team_id, to_team_id, cross_team, from_edge_id, to_edge_id, note, first_seen, last_seen)
     VALUES (@id, @from_id, @to_id, @kind, @via_node, @via, @declared, @derived, @support,
        @from_team_id, @to_team_id, @cross_team, @from_edge_id, @to_edge_id, @note, @first_seen, @last_seen)`
  )
  for (const r of rows.values()) {
    ins.run({
      ...r,
      cross_team: r.from_team_id && r.to_team_id && r.from_team_id !== r.to_team_id ? 1 : 0,
      first_seen: wasSeen.get(r.id) ?? now,
      last_seen: now,
    })
  }
}

/* ───────────────────────────── layer C: which teams a process reaches

   Beyond its own. A process's own team's components are in
   `process_components` already and are not a crossing; what this table holds
   is where the process leaves the team, and what carries it there. It is the
   whole of the HTTP case — `L2.1.3 Check the customer may trade` reaches
   identity through the endpoint it calls, which is true where "hands off to
   L1.1.1" was false.
*/

function rebuildProcessTeams() {
  db.prepare('DELETE FROM process_teams').run()
  const procs = db.prepare('SELECT id, team_id FROM processes').all()
  if (!procs.length) return
  const teamOfProc = new Map(procs.map((p) => [p.id, p.team_id]))

  const ins = db.prepare(
    `INSERT OR IGNORE INTO process_teams (process_id, team_id, via, via_node) VALUES (?, ?, ?, ?)`
  )

  for (const p of procs) if (p.team_id) ins.run(p.id, p.team_id, 'owner', '')

  for (const r of db
    .prepare(
      `SELECT c.process_id, n.team_id, n.id AS node_id
       FROM process_components c JOIN nodes n ON n.id = c.node_id
       WHERE n.team_id IS NOT NULL`
    )
    .all()) {
    if (r.team_id === teamOfProc.get(r.process_id)) continue
    ins.run(r.process_id, r.team_id, 'component', r.node_id)
  }

  // The carried leaf teams, not the row's own ends: a rolled-up row's ends are
  // ancestors whose owners may be other teams entirely, and attributing the
  // handoff to them would invent a crossing that never happened.
  for (const r of db.prepare('SELECT from_id, to_id, from_team_id, to_team_id FROM process_links').all()) {
    const a = r.from_team_id
    const b = r.to_team_id
    if (a && b && a !== b) {
      ins.run(r.from_id, b, 'handoff', '')
      ins.run(r.to_id, a, 'handoff', '')
    }
  }
}

/* ─────────────────────────────────────────────────────── orphan creation */

/**
 * An edge may point at something no manifest declared — normally because the
 * other end lives in a repo outside the scanned set. That is a finding, not an
 * error, so the node exists and is marked rather than being dropped.
 */
function createOrphans(now) {
  const missing = db
    .prepare(
      `SELECT DISTINCT id FROM (
         SELECT from_id AS id FROM edges UNION SELECT to_id AS id FROM edges
       ) WHERE id NOT IN (SELECT id FROM nodes)`
    )
    .all()

  const insert = db.prepare(
    `INSERT INTO nodes (id, kind, name, orphan, first_seen, last_seen) VALUES (?, ?, ?, 1, ?, ?)`
  )
  for (const { id } of missing) {
    insert.run(id, PREFIX_KIND[id.split(':', 1)[0]] ?? 'external', idValue(id), now, now)
  }
}

/* ────────────────────────────────────────────────────────────── ownership */

/**
 * Ownership is derived, so it is recomputed wholesale: a repo that stops
 * declaring the migrations for a database stops owning it. A service node is
 * owned by the repo that builds it, which ingest records directly and no edge
 * can contradict.
 */
function resolveOwnership() {
  db.prepare(`UPDATE nodes SET owner_repo = NULL WHERE kind <> 'service'`).run()

  const claims = db
    .prepare(
      `SELECT to_id, repo, kind, MIN(first_seen) AS first_seen
       FROM edges WHERE kind IN (${OWNING.map(() => '?').join(',')})
       GROUP BY to_id, repo, kind`
    )
    .all(...OWNING)

  const byNode = new Map()
  for (const c of claims) {
    if (!byNode.has(c.to_id)) byNode.set(c.to_id, [])
    byNode.get(c.to_id).push(c)
  }

  const setOwner = db.prepare(`UPDATE nodes SET owner_repo = ? WHERE id = ? AND kind <> 'service'`)
  for (const [id, list] of byNode) {
    // First claim wins; repo breaks a tie so a re-ingest cannot reshuffle it.
    list.sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.repo.localeCompare(b.repo))
    setOwner.run(list[0].repo, id)
  }
}

/* ─────────────────────────────────────────────────────────────── findings */

/**
 * Who should go and look at a finding.
 *
 * The same rules Layer C already uses to give a node a team, applied to
 * whatever the finding is about: its own team if it has one, the owning
 * team if it is a process, the team itself if it is a team. A subject with
 * no team of its own takes the team of the services around it — but only
 * when they agree, because a topic two teams publish has no owner and saying
 * otherwise would promote a tiebreak into an org fact.
 *
 * That leaves a version skew between two teams, and a topic two teams
 * publish, unrouted. Both are right: more than one team is the finding, and
 * naming one of them would be picking a side. Everything else lands
 * somewhere — 10 of the demo estate's 15, against 1 when the only rule was
 * the subject's own team.
 */
function teamRouter() {
  const node = new Map(db.prepare('SELECT id, kind, team_id FROM nodes').all().map((r) => [r.id, r]))
  const process = new Map(db.prepare('SELECT id, team_id FROM processes').all().map((r) => [r.id, r.team_id]))
  const neighbours = new Map()
  for (const e of db.prepare('SELECT from_id, to_id FROM edges').all()) {
    for (const [self, other] of [[e.from_id, e.to_id], [e.to_id, e.from_id]]) {
      if (!neighbours.has(self)) neighbours.set(self, new Set())
      neighbours.get(self).add(other)
    }
  }

  return (subjectId) => {
    if (!subjectId) return null
    if (subjectId.startsWith('proc:')) return process.get(subjectId) ?? null
    if (subjectId.startsWith('team:')) return subjectId.slice('team:'.length) || null
    const self = node.get(subjectId)
    if (!self) return null
    if (self.team_id) return self.team_id
    const around = new Set()
    for (const other of neighbours.get(subjectId) ?? []) {
      const n = node.get(other)
      if (n?.kind === 'service' && n.team_id) around.add(n.team_id)
    }
    return around.size === 1 ? [...around][0] : null
  }
}

function rebuildDrift(now) {
  /* When a finding was first seen has to outlive the table it lives in, or
     the rebuild below makes every finding seconds old on every link pass and
     nothing can be aged, sorted or chased. The fingerprint is what carries it
     across: same kind, same subject, same sentence, same finding. */
  const since = new Map(
    db
      .prepare('SELECT fingerprint, detected_at FROM drift WHERE fingerprint IS NOT NULL')
      .all()
      .map((r) => [r.fingerprint, r.detected_at])
  )

  db.prepare('DELETE FROM drift').run()
  const add = db.prepare(
    `INSERT INTO drift (kind, subject_id, severity, detail, data, detected_at, last_seen, fingerprint, team_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const routeTeam = teamRouter()
  const write = (kind, subjectId, severity, detail, data) => {
    const fingerprint = sha1(`${kind}|${subjectId ?? ''}|${detail}`)
    add.run(
      kind,
      subjectId,
      severity,
      detail,
      data ? JSON.stringify(data) : null,
      since.get(fingerprint) ?? now,
      now,
      fingerprint,
      routeTeam(subjectId)
    )
  }

  const nodes = db.prepare('SELECT * FROM nodes').all()
  const edges = db.prepare('SELECT * FROM edges').all()
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]))
  const label = (id) => nameOf.get(id) ?? idValue(id)

  const ends = (kind, to) => edges.filter((e) => e.kind === kind && e.to_id === to)

  /* topics with one side of the conversation missing */
  for (const topic of nodes.filter((n) => n.kind === 'kafka.topic')) {
    const producers = ends('kafka.produce', topic.id)
    const consumers = ends('kafka.consume', topic.id)

    if (consumers.length && !producers.length) {
      write(
        'no-producer',
        topic.id,
        'warn',
        `${consumers.length} service${consumers.length === 1 ? ' consumes' : 's consume'} ${topic.name}, ` +
          `but no scanned repo produces it — either it crosses a team boundary or the listeners are dead.`,
        { consumers: consumers.map((e) => ({ serviceId: e.from_id, name: label(e.from_id), repo: e.repo })) }
      )
    }
    if (producers.length && !consumers.length) {
      write(
        'no-consumer',
        topic.id,
        'info',
        `${topic.name} is produced but nothing in the scanned set consumes it.`,
        { producers: producers.map((e) => ({ serviceId: e.from_id, name: label(e.from_id), repo: e.repo })) }
      )
    }
  }

  /* one contract, two versions — the finding the binding table exists for */
  const bindings = db
    .prepare('SELECT contract_id, service_id, version FROM contract_bindings ORDER BY contract_id, service_id')
    .all()
  const byContract = new Map()
  for (const b of bindings) {
    if (!byContract.has(b.contract_id)) byContract.set(b.contract_id, [])
    byContract.get(b.contract_id).push(b)
  }
  for (const [contractId, list] of byContract) {
    const versions = [...new Set(list.map((b) => b.version).filter(Boolean))]
    if (versions.length > 1) {
      write(
        'version-skew',
        contractId,
        'warn',
        `${label(contractId)} is bound at ${andList(versions.sort())} across ${list.length} services.`,
        list.map((b) => ({ service_id: b.service_id, name: label(b.service_id), version: b.version }))
      )
    }
  }

  /* a database more than one service writes into */
  const writers = new Map()
  for (const e of edges.filter((x) => x.kind === 'db.write' || x.kind === 'db.owns')) {
    if (!writers.has(e.to_id)) writers.set(e.to_id, new Map())
    writers.get(e.to_id).set(e.from_id, e.kind === 'db.owns' ? 'owns' : 'writes')
  }
  for (const store of nodes.filter((n) => n.kind === 'database')) {
    const who = writers.get(store.id)
    if (!who || who.size < 2) continue
    write(
      'shared-database',
      store.id,
      'warn',
      `${who.size} services write into ${store.name}: ${[...who.keys()].map(label).join(', ')}.`,
      { services: [...who].map(([serviceId, how]) => ({ serviceId, name: label(serviceId), how })) }
    )
  }

  /* two repos claiming the same exclusive thing */
  const exclusive = new Map()
  for (const e of edges.filter((x) => EXCLUSIVE.has(x.kind))) {
    if (!exclusive.has(e.to_id)) exclusive.set(e.to_id, new Map())
    exclusive.get(e.to_id).set(e.repo, e.kind)
  }
  for (const [id, byRepo] of exclusive) {
    if (byRepo.size < 2) continue
    write(
      'multiple-owners',
      id,
      'warn',
      `${byRepo.size} repos claim ${label(id)}: ${[...byRepo.keys()].join(', ')}.`,
      { claims: [...byRepo].map(([repo, kind]) => ({ repo, kind })) }
    )
  }

  /* ids that are probably the same thing spelt twice — never merged */
  const buckets = new Map()
  for (const n of nodes) {
    const key = `${n.kind}|${normaliseId(n.id)}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(n.id)
  }
  for (const [key, ids] of buckets) {
    if (ids.length < 2) continue
    ids.sort()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        write(
          'near-miss',
          ids[i],
          'warn',
          `${ids[i]} and ${ids[j]} normalise to the same string. If they are one thing, one repo is spelling it wrong — a human decides, never the ingest.`,
          { ids: [ids[i], ids[j]], normalised: key.split('|')[1] }
        )
      }
    }
  }

  /* an endpoint somebody calls that nobody in the scanned set serves */
  for (const ep of nodes.filter((n) => n.kind === 'endpoint')) {
    const callers = ends('http.call', ep.id)
    if (!callers.length || ends('http.expose', ep.id).length) continue
    write(
      'orphan-endpoint',
      ep.id,
      'info',
      `${ep.name} is called by ${callers.length} service${callers.length === 1 ? '' : 's'}, but no scanned repo exposes it.`,
      { callers: callers.map((e) => ({ serviceId: e.from_id, name: label(e.from_id), repo: e.repo })) }
    )
  }

  processFindings(write, { nodes, nameOf, label })
  teamFindings(write, { nodes })
  handoffFindings(write)
}

/* ────────────────────── layer C: where the documents and the topology disagree
                                   about who hands off to whom */

function handoffFindings(write) {
  const procs = db.prepare('SELECT id, code, name, team_id FROM processes').all()
  if (!procs.length) return
  const byId = new Map(procs.map((p) => [p.id, p]))
  const teams = new Map(db.prepare('SELECT id, name FROM teams').all().map((t) => [t.id, t.name]))
  const teamName = (id) => teams.get(id) ?? id ?? 'nobody'
  const label = (p) => `L${p.code} ${p.name}`

  /* a declaration naming a process nobody has written.

     Recomputed here rather than threaded out of the link builder, because it
     is a fact about the packs rather than about the rows — and the common real
     case is a good one: the team you hand off to has not started using the map
     yet. */
  const { declared } = fromActivePacks()
  for (const [from, targets] of declared) {
    const a = byId.get(from)
    if (!a) continue
    for (const [to, note] of targets) {
      if (byId.has(to)) continue
      write(
        'process-link-unknown-target',
        from,
        'warn',
        `${label(a)} says it hands off to ${to.replace(/^proc:/, 'L')}, and no pack declares that ` +
          `process. Either the team at the other end has not written theirs yet, or the code has changed.`,
        { code: a.code, name: a.name, target: to.replace(/^proc:/, ''), note: note ?? null }
      )
    }
  }

  /* a branch pointing at a process nobody has written.

     The same rule once more: a pack may not bring a process into existence, so
     a `next` naming a code that does not resolve is reported rather than
     rejected. It is a likelier mistake than an unknown handoff target, because
     a branch is usually written to a sibling and a renumbering breaks it
     silently — the flow simply stops drawing that arm. */
  for (const r of db
    .prepare(`SELECT * FROM process_next WHERE to_id IS NOT NULL AND resolved = 0`)
    .all()) {
    const a = byId.get(r.from_id)
    if (!a) continue
    write(
      'process-flow-unknown-target',
      r.from_id,
      'warn',
      `${label(a)} continues to ${r.to_id.replace(/^proc:/, 'L')}${
        r.condition ? ` when ${r.condition}` : ''
      }, and no pack declares that process. The branch is drawn as a dead end until one does.`,
      { code: a.code, name: a.name, target: r.to_id.replace(/^proc:/, ''), condition: r.condition }
    )
  }

  /* a declared handoff with nothing at all behind it.

     `support = 'none'` rather than `derived = 0`: a declared HTTP handoff is
     never derived, and reporting every one of those would make the finding
     cry wolf on exactly the declarations worth writing. Only a claim whose two
     processes do not even touch the same component is reported. */
  for (const r of db
    .prepare(
      `SELECT * FROM process_links WHERE declared = 1 AND support = 'none' AND via = 'interaction'`
    )
    .all()) {
    const a = byId.get(r.from_id)
    const b = byId.get(r.to_id)
    if (!a || !b) continue
    write(
      'process-link-unsupported',
      r.from_id,
      'warn',
      `${label(a)} says it hands off to ${label(b)}, and the two do not touch a single component ` +
        `between them. No message, no call, no shared store — either the handoff is not built yet, ` +
        `or it stopped being true and the document did not follow.`,
      {
        code: a.code, name: a.name,
        target: b.code, targetName: b.name,
        fromTeam: a.team_id ?? null, toTeam: b.team_id ?? null,
        note: r.note ?? null,
      }
    )
  }

  /* a handoff that leaves the team and is in nobody's document.

     Info, and cross-team only. An internal handoff between two of a team's own
     processes does not need writing down — the team knows. One that crosses a
     boundary and appears in no pack is the one worth a line. */
  for (const r of db
    .prepare(
      `SELECT * FROM process_links
       WHERE derived = 1 AND declared = 0 AND cross_team = 1 AND via = 'interaction'`
    )
    .all()) {
    const a = byId.get(r.from_id)
    const b = byId.get(r.to_id)
    if (!a || !b) continue
    write(
      'process-link-undocumented',
      r.from_id,
      'info',
      `${label(a)} hands off to ${label(b)} over ${idValue(r.via_node ?? '')}, crossing from ` +
        `${teamName(a.team_id)} to ${teamName(b.team_id)}, and neither pack says so. The code does ` +
        `this; the documents do not mention it.`,
      {
        code: a.code, name: a.name,
        target: b.code, targetName: b.name,
        fromTeam: a.team_id ?? null, toTeam: b.team_id ?? null,
        via: r.via_node ?? null,
      }
    )
  }
}

/* ─────────────────────────────────── layer C: who is responsible, and who is not

   Three hygiene findings. They are what a department rolling this out actually
   needs: which teams are not in the registry, which services nobody owns, and
   which process has no accountable team.
*/

function teamFindings(write, { nodes }) {
  const teams = db.prepare('SELECT id, name, registered FROM teams').all()
  const teamName = (id) => teams.find((t) => t.id === id)?.name ?? id

  /* a team the data uses that the registry has never heard of.

     Only when a registry is loaded: with no teams.json every team is
     unregistered and this would report the whole organisation, which is the
     same argument SPEC-PROCESSES §5 makes for uncovered-component against an
     empty Layer B. */
  if (registryConfigured()) {
    for (const t of teams.filter((x) => !x.registered)) {
      const components = db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE team_id = ?').get(t.id).n
      const processes = db.prepare('SELECT COUNT(*) AS n FROM processes WHERE team_id = ?').get(t.id).n
      write(
        'unknown-team',
        `team:${t.id}`,
        'warn',
        `${t.name} owns ${components} component${components === 1 ? '' : 's'} and ` +
          `${processes} process${processes === 1 ? '' : 'es'}, and is not in teams.json. ` +
          `Either it was renamed or merged and the documents have not followed, or the registry is behind.`,
        { team: t.id, name: t.name, components, processes }
      )
    }
  }

  /* a service nobody owns.

     Services only. A contract, an external, an unproduced topic and a cache
     with two writers are all legitimately teamless, and firing on them would
     bury the one case that is a real gap. */
  // Not an orphan: createOrphans() invents a service node for one referenced by
  // an edge and never scanned, which by construction has no manifest, no team
  // and no remedy short of scanning a repository the reader does not have. An
  // orphan service is somebody else's, exactly as an external is.
  for (const n of nodes.filter((x) => x.kind === 'service' && !x.team_id && !x.orphan)) {
    write(
      'component-no-team',
      n.id,
      'info',
      `${n.name} has no owning team. Nobody is accountable for it in the map, so nothing can say ` +
        `which processes it puts at risk.`,
      { kind: n.kind, repo: n.owner_repo ?? null }
    )
  }

  /* two teams publishing to one topic.

     Layer A deliberately raises no finding for fan-in onto a topic, because
     several producers is not a defect (DECISIONS.md). But it means the topic
     has no single owning team, so it is grey on the team lens and absent from
     every team's filter, and nothing would otherwise say why. Two teams
     sharing a publish is also a real coordination fact worth one line. */
  for (const t of db
    .prepare(
      `SELECT e.to_id AS topic, COUNT(DISTINCT n.team_id) AS teams,
              GROUP_CONCAT(DISTINCT n.team_id) AS list
       FROM edges e JOIN nodes n ON n.id = e.from_id
       WHERE e.kind = 'kafka.produce' AND n.team_id IS NOT NULL
       GROUP BY e.to_id HAVING teams > 1`
    )
    .all()) {
    const names = String(t.list).split(',').map(teamName)
    write(
      'multi-team-topic',
      t.topic,
      'info',
      `${idValue(t.topic)} is published by ${andList(names)}. No one team owns it, so a change to ` +
        `what goes on it is a conversation rather than a decision — and it has no team on the map.`,
      { topic: t.topic, teams: String(t.list).split(',') }
    )
  }

  /* a process nobody owns, at the levels where it matters.

     Level 1 and 2 only: an atomic action inherits its accountability from the
     stage above it, and flagging all 34 leaves would train people to ignore
     the group. */
  /* Asked of the DOCUMENT, not of the resolved team: with inheritance in place
     `team_id IS NULL` is nearly unfireable, and the question is whether anybody
     wrote down who is accountable. Inheriting is a convenience for leaves; at
     level 1 or 2 — the levels a director reads — it should be said out loud. */
  for (const p of db
    .prepare(
      `SELECT id, code, name, level FROM processes
       WHERE level <= 2 AND (team_via IS NULL OR team_via = 'inherited') ORDER BY sort_key`
    )
    .all()) {
    write(
      'process-no-owner',
      p.id,
      'info',
      `L${p.code} ${p.name} names no owner. At level ${p.level} that is the question the map exists ` +
        `to answer — somebody is accountable for it, and the document does not say who.`,
      { code: p.code, name: p.name, level: p.level }
    )
  }
}

/* ──────────────────────────────────── layer B: where the two layers disagree

   This is the reason Layer B is worth having. A document naming a component
   the code does not have, or a call the code does not make, is a finding no
   other part of the estate can produce — and it is always reported, never
   repaired. A pack does not get to create what it is missing.
*/

function processFindings(write, { nodes, nameOf, label }) {
  const procs = db.prepare('SELECT * FROM processes ORDER BY sort_key').all()
  const packs = db.prepare(`SELECT COUNT(*) AS n FROM process_packs WHERE status = 'active'`).get().n
  if (!procs.length) return

  const { touches, owners } = fromActivePacks()
  const known = new Set(nodes.map((n) => n.id))
  const byId = new Map(procs.map((p) => [p.id, p]))
  const hasChildren = new Set(procs.map((p) => p.parent_id).filter(Boolean))
  const named = (p) => `L${p.code} · ${p.name}`

  for (const p of procs) {
    /* a component the document names and the map has never seen */
    const referenced = new Map()
    if (p.node_id) referenced.set(p.node_id, 'the component it happens at')
    for (const t of touches.get(p.id) ?? []) if (!referenced.has(t)) referenced.set(t, 'a component it also uses')
    if (p.edge_from) {
      if (!referenced.has(p.edge_from)) referenced.set(p.edge_from, 'the near end of its interaction')
      if (!referenced.has(p.edge_to)) referenced.set(p.edge_to, 'the far end of its interaction')
    }

    const missing = [...referenced].filter(([id]) => !known.has(id))
    for (const [id, how] of missing) {
      write(
        'process-missing-component',
        p.id,
        'warn',
        `${named(p)} names ${id} as ${how}, and no scan has ever found it. Either the scan missed it, ` +
          `or this document is describing something that no longer exists.`,
        { code: p.code, name: p.name, component: id, how, kind: PREFIX_KIND[id.split(':', 1)[0]] ?? null }
      )
    }

    /* the most interesting finding in the tool: both ends are real, and the
       relationship between them is not. The document describes a call the code
       does not make. Suppressed only when one of the interaction's OWN ends is
       missing — there the missing component is the root cause and this would be
       the same fact twice. A typo in an unrelated `touches` entry is not a root
       cause for this, and must not hide it. */
    if (p.edge_from && !p.edge_id && known.has(p.edge_from) && known.has(p.edge_to)) {
      write(
        'process-missing-interaction',
        p.id,
        'warn',
        `${named(p)} says ${label(p.edge_from)} ${EDGE_PHRASE[p.edge_kind] ?? p.edge_kind} ${label(p.edge_to)}. ` +
          `Both ends exist, but no scanned repository does that — either the scan missed it, or this ` +
          `stopped being true and the document did not follow.`,
        {
          code: p.code,
          name: p.name,
          from: p.edge_from,
          kind: p.edge_kind,
          to: p.edge_to,
          fromName: nameOf.get(p.edge_from) ?? null,
          toName: nameOf.get(p.edge_to) ?? null,
        }
      )
    }

    /* a code whose parent is nowhere in the estate */
    if (p.parent_id && !byId.has(p.parent_id)) {
      write(
        'process-orphan-code',
        p.id,
        'warn',
        `${named(p)} is a level ${p.level}, so its parent is ${p.parent_id.slice(5)} — and no pack declares that code.`,
        { code: p.code, name: p.name, parentCode: p.parent_id.slice(5) }
      )
    }

    /* a leaf that is a title and nothing else */
    const leaf = !hasChildren.has(p.id)
    if (leaf && !p.node_id && !p.edge_from && !(touches.get(p.id)?.size)) {
      write(
        'process-no-detail',
        p.id,
        'info',
        `${named(p)} decomposes into nothing and names no component, so nothing connects it to the estate.`,
        { code: p.code, name: p.name, level: p.level }
      )
    }
  }

  /* one number, two claims. The processes row can only hold the last writer,
     so this is read off the packs themselves — including a pack that declares
     the same code twice, which loses a process just as quietly. */
  for (const [code, claimed] of owners) {
    const total = [...claimed.values()].reduce((a, b) => a + b, 0)
    if (total < 2) continue
    const packs = [...claimed.keys()].sort()
    write(
      'process-duplicate-code',
      `proc:${code}`,
      'warn',
      packs.length > 1
        ? `${andList(packs)} both declare L${code}. Codes are cited in tickets, so one pack has to renumber — a human decides which, and until then only one of the two is in the map.`
        : `${packs[0]} declares L${code} ${total} times. Only the last one is in the map; the others were quietly overwritten.`,
      { code, packs, claims: [...claimed].map(([pack, times]) => ({ pack, times })) }
    )
  }

  /* what no documented process accounts for. Only services and topics, and
     only once something is loaded — fired against an empty Layer B it would
     report the whole estate and train people to ignore it. */
  if (!packs) return
  const covered = new Set(db.prepare('SELECT DISTINCT node_id FROM process_components').all().map((r) => r.node_id))
  for (const n of nodes) {
    if (n.kind !== 'service' && n.kind !== 'kafka.topic') continue
    if (covered.has(n.id)) continue
    write(
      'uncovered-component',
      n.id,
      'info',
      `No documented process touches ${n.name}. Either a process pack is incomplete, or nothing in the business depends on it.`,
      { kind: n.kind, ownerRepo: n.owner_repo ?? null }
    )
  }
}
