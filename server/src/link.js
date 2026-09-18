import { db } from './db.js'

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
  rebuildDrift(now)
})

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
}
