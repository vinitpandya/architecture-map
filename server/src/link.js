import { db } from './db.js'
import { rebuildTeams, registryConfigured, teamId } from './teams.js'

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
 * Two ids are a near miss when they collapse to the same string: case,
 * separators and a trailing version suffix removed. `users.created.v2` and
 * `UsersCreatedV2` are almost certainly the same topic spelt twice.
 */
export const normaliseId = (id) =>
  idValue(id)
    .toLowerCase()
    .replace(/[._-]/g, '')
    .replace(/v\d+$/, '')

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

  // A human correction outranks the scan, per SPEC.md §15.4.
  const overridden = new Map(
    db
      .prepare(`SELECT subject_id, value FROM overrides WHERE subject_kind = 'node' AND field = 'team'`)
      .all()
      .map((r) => [r.subject_id, r.value])
  )

  const teamOfService = new Map()
  for (const n of db.prepare(`SELECT id, team FROM nodes WHERE kind = 'service'`).all()) {
    const raw = overridden.get(n.id) ?? n.team
    const id = teamId(raw)
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

  // Exactly one service writing to it, for the nodes no `owns` edge covers.
  const writers = new Map()
  for (const e of db
    .prepare(`SELECT from_id, to_id FROM edges WHERE kind IN ('db.write', 'cache.write')`)
    .all()) {
    if (!writers.has(e.to_id)) writers.set(e.to_id, new Set())
    writers.get(e.to_id).add(e.from_id)
  }

  const set = db.prepare('UPDATE nodes SET team_id = ? WHERE id = ?')
  for (const n of db.prepare('SELECT id, kind, team, owner_repo FROM nodes').all()) {
    let id = null
    if (n.kind === 'service') {
      id = teamOfService.get(n.id) ?? null
    } else {
      const over = overridden.get(n.id)
      id = teamId(over) || null
      if (!id && n.owner_repo) id = teamOfRepo.get(n.owner_repo) ?? null
      if (!id) {
        const w = writers.get(n.id)
        if (w && w.size === 1) id = teamOfService.get([...w][0]) ?? null
      }
    }
    if (id) set.run(id, n.id)
  }

  db.prepare(`UPDATE processes SET team_id = NULL`).run()
  const setProc = db.prepare('UPDATE processes SET team_id = ? WHERE id = ?')
  for (const p of db.prepare('SELECT id, owner FROM processes').all()) {
    const id = teamId(p.owner)
    if (id) setProc.run(id, p.id)
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
      if (!p.touches?.length) continue
      if (!touches.has(id)) touches.set(id, new Set())
      for (const nodeId of p.touches) touches.get(id).add(nodeId)
    }
  }
  return { touches, owners }
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

function rebuildDrift(now) {
  db.prepare('DELETE FROM drift').run()
  const add = db.prepare(
    `INSERT INTO drift (kind, subject_id, severity, detail, data, detected_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const write = (kind, subjectId, severity, detail, data) =>
    add.run(kind, subjectId, severity, detail, data ? JSON.stringify(data) : null, now)

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
}

/* ─────────────────────────────────── layer C: who is responsible, and who is not

   Three hygiene findings. They are what a department rolling this out actually
   needs: which teams are not in the registry, which services nobody owns, and
   which process has no accountable team.
*/

function teamFindings(write, { nodes }) {
  const teams = db.prepare('SELECT id, name, registered FROM teams').all()

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
  for (const n of nodes.filter((x) => x.kind === 'service' && !x.team_id)) {
    write(
      'component-no-team',
      n.id,
      'info',
      `${n.name} has no owning team. Nobody is accountable for it in the map, so nothing can say ` +
        `which processes it puts at risk.`,
      { kind: n.kind, repo: n.owner_repo ?? null }
    )
  }

  /* a process nobody owns, at the levels where it matters.

     Level 1 and 2 only: an atomic action inherits its accountability from the
     stage above it, and flagging all 34 leaves would train people to ignore
     the group. */
  for (const p of db
    .prepare('SELECT id, code, name, level FROM processes WHERE level <= 2 AND team_id IS NULL ORDER BY sort_key')
    .all()) {
    write(
      'process-no-owner',
      p.id,
      'info',
      `L${p.code} ${p.name} has no owner. At level ${p.level} that is the question the map exists ` +
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
