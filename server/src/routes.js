import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { ROOT, INBOX_DIR } from './config.js'
import { db, getConfig, setConfig, hasData } from './db.js'
import { defaultPageLayout, instantiateLayout, templateFor } from './pageTemplates.js'

export const router = express.Router()

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback
  } catch {
    return fallback
  }
}

/**
 * A filter value that may arrive once, comma-separated, or repeated —
 * `?kinds=a&kinds=b`, which Express hands over as an array. Always a flat list
 * of strings, because an array reaching better-sqlite3 as a bind parameter is
 * spread into the placeholder list and throws, taking the request down with it.
 */
const list = (v) =>
  (Array.isArray(v) ? v : [v])
    .flatMap((x) => String(x ?? '').split(','))
    .map((s) => s.trim())
    .filter(Boolean)

/** The same hazard where one value is wanted: the last one repeated wins. */
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v)

/* ───────────────────────────────────────────────────────── overrides */

/** subject_kind|subject_id → {field: value}, applied on top of derived rows. */
function overrideMap(subjectKind) {
  const rows = db.prepare('SELECT * FROM overrides WHERE subject_kind = ?').all(subjectKind)
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.subject_id)) map.set(r.subject_id, {})
    map.get(r.subject_id)[r.field] = r.value
  }
  return map
}

function applyNodeOverrides(node, map) {
  const o = map.get(node.id)
  if (!o) return node
  return {
    ...node,
    name: o.name ?? node.name,
    description: o.description ?? node.description,
    team: o.team ?? node.team,
    hidden: o.hidden === 'true',
    confirmed: o.confirmed === 'true',
  }
}

const nodeRow = (r) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  engine: r.engine,
  method: r.method,
  path: r.path,
  contractType: r.contract_type,
  language: r.language,
  team: r.team,
  ownerRepo: r.owner_repo,
  orphan: !!r.orphan,
  degree: r.degree ?? undefined,
})

const edgeRow = (r) => ({
  id: r.id,
  from: r.from_id,
  to: r.to_id,
  kind: r.kind,
  contractId: r.contract_id,
  description: r.description,
  confidence: r.confidence,
  repo: r.repo,
})

/* ───────────────────────────────────────────────────────── status */

router.get('/status', wrap(async (req, res) => {
  const byKind = Object.fromEntries(
    db.prepare('SELECT kind, COUNT(*) AS n FROM nodes GROUP BY kind').all().map((r) => [r.kind, r.n])
  )
  const driftByKind = Object.fromEntries(
    db.prepare('SELECT kind, COUNT(*) AS n FROM drift GROUP BY kind').all().map((r) => [r.kind, r.n])
  )
  res.json({
    ready: hasData(),
    counts: {
      services: byKind['service'] ?? 0,
      topics: byKind['kafka.topic'] ?? 0,
      databases: byKind['database'] ?? 0,
      caches: byKind['cache'] ?? 0,
      contracts: byKind['contract'] ?? 0,
      endpoints: byKind['endpoint'] ?? 0,
      externals: byKind['external'] ?? 0,
      orphans: db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE orphan = 1').get().n,
      edges: db.prepare('SELECT COUNT(*) AS n FROM edges').get().n,
      unresolved: db.prepare('SELECT COUNT(*) AS n FROM unresolved').get().n,
      drift: db.prepare('SELECT COUNT(*) AS n FROM drift').get().n,
      driftWarn: db.prepare(`SELECT COUNT(*) AS n FROM drift WHERE severity = 'warn'`).get().n,
      quarantined: db.prepare(`SELECT COUNT(*) AS n FROM manifests WHERE status = 'quarantined'`).get().n,
      processes: db.prepare('SELECT COUNT(*) AS n FROM processes').get().n,
      processLeaves: db
        .prepare(
          `SELECT COUNT(*) AS n FROM processes p
           WHERE NOT EXISTS (SELECT 1 FROM processes c WHERE c.parent_id = p.id)`
        )
        .get().n,
      processPacks: db.prepare(`SELECT COUNT(*) AS n FROM process_packs WHERE status = 'active'`).get().n,
      quarantinedPacks: db
        .prepare(`SELECT COUNT(*) AS n FROM process_packs WHERE status = 'quarantined'`)
        .get().n,
    },
    // How much of the estate any documented process accounts for, over the two
    // kinds worth asking about. Zero of zero when nothing is loaded.
    coverage: db
      .prepare(
        // COALESCE because SUM over zero rows is NULL, and a fresh install
        // would otherwise answer {total: 0, covered: null} against a contract
        // that says both are numbers.
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN id IN (SELECT node_id FROM process_components) THEN 1 ELSE 0 END), 0) AS covered
         FROM nodes WHERE kind IN ('service', 'kafka.topic')`
      )
      .get(),
    driftByKind,
    repos: db
      .prepare(
        `SELECT repo, commit_sha, branch, scanned_at, ingested_at, producer_kind, status
         FROM manifests WHERE status = 'active' ORDER BY repo`
      )
      .all()
      .map((r) => ({
        repo: r.repo,
        commit: r.commit_sha,
        branch: r.branch,
        scannedAt: r.scanned_at,
        ingestedAt: r.ingested_at,
        producer: r.producer_kind,
      })),
    // Across both kinds of arrival. Four screens key their refresh on this,
    // and a pack that landed without a manifest beside it left every one of
    // them showing the estate as it was before the sweep.
    lastIngestAt:
      db
        .prepare(
          `SELECT MAX(t) AS t FROM (
             SELECT MAX(ingested_at) AS t FROM manifests
             UNION ALL
             SELECT MAX(ingested_at) AS t FROM process_packs
           )`
        )
        .get().t ?? null,
  })
}))

/* ───────────────────────────────────────────────────────── nodes & edges */

router.get('/nodes', wrap(async (req, res) => {
  const kinds = list(req.query.kinds)
  const repos = list(req.query.repos)
  const where = []
  const args = []
  if (kinds.length) {
    where.push(`n.kind IN (${kinds.map(() => '?').join(',')})`)
    args.push(...kinds)
  }
  if (repos.length) {
    where.push(`n.owner_repo IN (${repos.map(() => '?').join(',')})`)
    args.push(...repos)
  }
  if (req.query.includeExternal === 'false') where.push(`n.orphan = 0 AND n.kind != 'external'`)

  const rows = db
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id OR e.to_id = n.id) AS degree
       FROM nodes n
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY n.kind, n.name
       LIMIT ?`
    )
    .all(...args, Number(req.query.limit) || 500)

  const ov = overrideMap('node')
  res.json({ nodes: rows.map(nodeRow).map((n) => applyNodeOverrides(n, ov)).filter((n) => !n.hidden) })
}))

router.get('/node', wrap(async (req, res) => {
  const id = String(req.query.id || '')
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: 'No such node' })

  const ov = overrideMap('node')
  const node = applyNodeOverrides(nodeRow(row), ov)

  const out = db.prepare('SELECT * FROM edges WHERE from_id = ?').all(id).map(edgeRow)
  const into = db.prepare('SELECT * FROM edges WHERE to_id = ?').all(id).map(edgeRow)
  const evidence = db
    .prepare(`SELECT * FROM evidence WHERE subject_kind = 'node' AND subject_id = ?`)
    .all(id)

  // Edges that name this node as the payload they carry: for a contract, the
  // topics that carry it and the calls that pass it.
  const viaContract = db.prepare('SELECT * FROM edges WHERE contract_id = ?').all(id).map(edgeRow)

  // Which bindings are worth showing depends on what the node is. A topic's
  // are the bindings of the contracts it carries — that is where a reader
  // sees the skew, on the screen where it matters.
  const bindings = bindingsFor(row, viaContract, into)

  const neighbourIds = [...new Set([...out.map((e) => e.to), ...into.map((e) => e.from)])]
  const neighbours = neighbourIds.length
    ? db
        .prepare(`SELECT * FROM nodes WHERE id IN (${neighbourIds.map(() => '?').join(',')})`)
        .all(...neighbourIds)
        .map(nodeRow)
        .map((n) => applyNodeOverrides(n, ov))
    : []

  // Every citation behind every edge on this page, keyed by edge, so a row can
  // show its file:line without a request each.
  const edgeIds = [...out, ...into].map((e) => e.id)
  const edgeEvidence = {}
  if (edgeIds.length) {
    for (const e of db
      .prepare(
        `SELECT * FROM evidence WHERE subject_kind = 'edge' AND subject_id IN (${edgeIds
          .map(() => '?')
          .join(',')})`
      )
      .all(...edgeIds)) {
      ;(edgeEvidence[e.subject_id] ??= []).push(e)
    }
  }

  // Which business processes run through this component. Deepest first: a
  // level 3 says what actually happens here, a level 1 says which part of the
  // business it belongs to, and both are worth showing.
  const processes = db
    .prepare(
      `SELECT p.id, p.code, p.name, p.level, p.owner, c.via
       FROM process_components c JOIN processes p ON p.id = c.process_id
       WHERE c.node_id = ?
       ORDER BY p.level DESC, p.sort_key`
    )
    .all(id)

  res.json({
    node,
    out,
    in: into,
    evidence,
    edgeEvidence,
    bindings,
    viaContract,
    neighbours,
    processes,
    drift: db.prepare('SELECT * FROM drift WHERE subject_id = ?').all(id),
  })
}))

function bindingsFor(row, viaContract, into) {
  const all = (ids) =>
    ids.length
      ? db
          .prepare(
            `SELECT * FROM contract_bindings WHERE contract_id IN (${ids.map(() => '?').join(',')})
             ORDER BY contract_id, service_id`
          )
          .all(...ids)
      : []

  if (row.kind === 'contract') return all([row.id])
  if (row.kind === 'service') {
    return db
      .prepare('SELECT * FROM contract_bindings WHERE service_id = ? ORDER BY contract_id')
      .all(row.id)
  }
  if (row.kind === 'kafka.topic') {
    const carried = [...new Set(into.map((e) => e.contractId).filter(Boolean))]
    return all(carried)
  }
  return []
}

router.get('/edges', wrap(async (req, res) => {
  const kinds = list(req.query.kinds)
  const rows = db
    .prepare(
      `SELECT * FROM edges
       ${kinds.length ? `WHERE kind IN (${kinds.map(() => '?').join(',')})` : ''}
       ORDER BY from_id, kind LIMIT ?`
    )
    .all(...kinds, Number(req.query.limit) || 500)
  res.json({ edges: rows.map(edgeRow) })
}))

router.get('/edge', wrap(async (req, res) => {
  const id = String(req.query.id || '')
  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: 'No such edge' })
  res.json({
    edge: edgeRow(row),
    evidence: db
      .prepare(`SELECT * FROM evidence WHERE subject_kind = 'edge' AND subject_id = ?`)
      .all(id),
    from: db.prepare('SELECT * FROM nodes WHERE id = ?').get(row.from_id) ?? null,
    to: db.prepare('SELECT * FROM nodes WHERE id = ?').get(row.to_id) ?? null,
  })
}))

/**
 * Producers and consumers of one topic — the question this whole tool exists
 * to answer, so it gets its own endpoint rather than making the UI derive it.
 */
router.get('/topic-flow', wrap(async (req, res) => {
  const id = String(req.query.id || '')
  const side = (kind) =>
    db
      .prepare(
        `SELECT e.*, n.name AS service_name, n.team
         FROM edges e LEFT JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id = ? AND e.kind = ? ORDER BY n.name`
      )
      .all(id, kind)
  res.json({
    topic: db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) ?? null,
    producers: side('kafka.produce').map((r) => ({ ...edgeRow(r), serviceName: r.service_name, team: r.team })),
    consumers: side('kafka.consume').map((r) => ({ ...edgeRow(r), serviceName: r.service_name, team: r.team })),
  })
}))

/** Every service binding of every contract, with a skew flag per contract. */
router.get('/contract-versions', wrap(async (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.contract_id, b.service_id, b.version, n.name AS contract_name
       FROM contract_bindings b LEFT JOIN nodes n ON n.id = b.contract_id
       ORDER BY b.contract_id, b.service_id`
    )
    .all()
  const byContract = new Map()
  for (const r of rows) {
    if (!byContract.has(r.contract_id)) {
      byContract.set(r.contract_id, { contractId: r.contract_id, name: r.contract_name, bindings: [] })
    }
    byContract.get(r.contract_id).bindings.push({ serviceId: r.service_id, version: r.version })
  }
  const contracts = [...byContract.values()].map((c) => ({
    ...c,
    versions: [...new Set(c.bindings.map((b) => b.version))],
    skew: new Set(c.bindings.map((b) => b.version)).size > 1,
  }))
  res.json({ contracts: req.query.skewOnly === 'true' ? contracts.filter((c) => c.skew) : contracts })
}))

router.get('/drift', wrap(async (req, res) => {
  const where = []
  const args = []
  // Through list(), so asking for two kinds is an IN rather than a bind error.
  const kinds = list(req.query.kind)
  const severities = list(req.query.severity)
  if (kinds.length) {
    where.push(`kind IN (${kinds.map(() => '?').join(',')})`)
    args.push(...kinds)
  }
  if (severities.length) {
    where.push(`severity IN (${severities.map(() => '?').join(',')})`)
    args.push(...severities)
  }
  const rows = db
    .prepare(
      `SELECT * FROM drift ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY severity DESC, kind, subject_id LIMIT ?`
    )
    .all(...args, Number(req.query.limit) || 500)
  res.json({ findings: rows.map((r) => ({ ...r, data: parse(r.data, null) })) })
}))

router.get('/unresolved', wrap(async (req, res) => {
  res.json({
    unresolved: db
      .prepare('SELECT * FROM unresolved ORDER BY repo, expected LIMIT ?')
      .all(Number(req.query.limit) || 500),
  })
}))

/* ───────────────────────────────────────────────────────── search */

/**
 * FTS5 chokes on the punctuation that fills our ids — `payments.settled.v1`,
 * `GET /v1/x/{}`. Quote every bare term and let the prefix operator through.
 */
function ftsQuery(raw) {
  const terms = String(raw).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return null
  return terms.map((t) => `"${t.replace(/"/g, '')}"${t.length >= 3 ? '*' : ''}`).join(' ')
}

/**
 * What a person types to mean a kind. Node kinds are filtered by their id
 * prefix, which every id carries, so nothing has to be stored twice.
 */
const KIND_PREFIX = {
  service: 'svc', svc: 'svc',
  topic: 'topic', 'kafka.topic': 'topic', kafka: 'topic',
  database: 'db', db: 'db',
  cache: 'cache',
  endpoint: 'api', api: 'api', http: 'api',
  contract: 'contract',
  external: 'ext', ext: 'ext',
}

/** The subject kinds `search_index` stores, and what a person types for each. */
const SUBJECT_KIND = {
  edge: 'edge',
  unresolved: 'unresolved',
  node: 'node',
  process: 'process',
  proc: 'process',
}

/** `kind:topic settled` — the filter comes off the front, the rest is the query. */
function parseQuery(raw, explicit) {
  let text = String(raw ?? '').trim()
  const kinds = explicit ? [String(explicit)] : []
  let m
  while ((m = /^kind:([a-z.]+)\s*/i.exec(text))) {
    kinds.push(m[1].toLowerCase())
    text = text.slice(m[0].length)
  }
  return { text, kinds }
}

router.get('/search', wrap(async (req, res) => {
  const { text, kinds } = parseQuery(req.query.q, req.query.kind)
  const where = []
  const args = []

  for (const k of kinds) {
    // `process` is a subject kind of the index in its own right, and the
    // search page groups its hits under a heading of their own — narrowing to
    // that heading has to be able to find them.
    const subject = SUBJECT_KIND[k]
    if (subject) {
      where.push('subject_kind = ?')
      args.push(subject)
    } else if (KIND_PREFIX[k]) {
      where.push(`subject_kind = 'node' AND subject_id LIKE ?`)
      args.push(`${KIND_PREFIX[k]}:%`)
    } else {
      // An unknown kind matches nothing, which beats silently ignoring it.
      return res.json({ hits: [] })
    }
  }

  const q = ftsQuery(text)
  if (!q && !where.length) return res.json({ hits: [] })

  try {
    // A bare `kind:` with no search terms lists that kind rather than nothing;
    // MATCH needs a term, so the two cases are different statements.
    const rows = q
      ? db
          .prepare(
            `SELECT subject_kind, subject_id, title, repo,
                    snippet(search_index, 3, '<mark>', '</mark>', '…', 12) AS snippet
             FROM search_index
             WHERE search_index MATCH ? ${where.map((w) => `AND (${w})`).join(' ')}
             ORDER BY bm25(search_index) LIMIT ?`
          )
          .all(q, ...args, Number(req.query.limit) || 50)
      : db
          .prepare(
            `SELECT subject_kind, subject_id, title, repo, '' AS snippet
             FROM search_index WHERE ${where.map((w) => `(${w})`).join(' AND ')}
             ORDER BY title LIMIT ?`
          )
          .all(...args, Number(req.query.limit) || 50)

    // An edge hit is a relationship, not a place: carry both ends so the UI
    // can link somewhere that exists. There is no edge page in v1.
    const edgeIds = rows.filter((r) => r.subject_kind === 'edge').map((r) => r.subject_id)
    const ends = new Map(
      edgeIds.length
        ? db
            .prepare(`SELECT id, from_id, to_id FROM edges WHERE id IN (${edgeIds.map(() => '?').join(',')})`)
            .all(...edgeIds)
            .map((e) => [e.id, e])
        : []
    )

    res.json({
      hits: rows.map((r) => ({
        ...r,
        kind: subjectKind(r),
        from: ends.get(r.subject_id)?.from_id ?? null,
        to: ends.get(r.subject_id)?.to_id ?? null,
      })),
    })
  } catch {
    // A malformed query is an empty result, never a 500.
    res.json({ hits: [] })
  }
}))

/** The node kind behind a hit, so the UI can badge it without a second fetch. */
function subjectKind(row) {
  if (row.subject_kind !== 'node') return row.subject_kind
  const prefix = row.subject_id.split(':', 1)[0]
  return (
    { svc: 'service', topic: 'kafka.topic', db: 'database', cache: 'cache', api: 'endpoint', contract: 'contract', ext: 'external' }[
      prefix
    ] ?? 'external'
  )
}

/* ───────────────────────────────────────────────────────── graph */

router.get('/graph', wrap(async (req, res) => {
  const focus = String(req.query.focus || '')
  const asked = Number(req.query.depth)
  // 'all' and 0 both mean the whole connected component; anything else is a
  // hop count, defaulting to the focus plus its direct neighbours.
  const depth =
    req.query.depth === 'all' || asked === 0 ? Infinity : Number.isFinite(asked) && asked > 0 ? asked : 1
  const kinds = list(req.query.kinds)
  const repos = list(req.query.repos)
  const includeExternal = req.query.includeExternal !== 'false'
  // §8: "Default: all but `contract`" — contracts clutter the default view and
  // are opt-in. An explicit `kinds` says exactly what it wants; an absent one
  // means everything a person would expect to see on a map.
  const hideContracts = !kinds.length

  const allEdges = db.prepare('SELECT * FROM edges').all()
  let keep = null

  // A process is a filter, not a selection: asking for 2 gives the whole of
  // order and execution, 2.1 gives just the estimate. Combined with a focus,
  // the process bounds the graph and the focus picks within it.
  const processCode = String(req.query.process || '').trim().replace(/^[Ll]/, '')
  let withinProcess = null
  if (processCode) {
    const proc = db.prepare('SELECT id FROM processes WHERE code = ?').get(processCode)
    // An unknown process is an empty graph, not the whole estate — but the
    // response still says which one was asked for, so the caller can tell the
    // difference between "nothing matched" and "no filter".
    if (!proc) return res.json({ nodes: [], edges: [], process: processCode, unknownProcess: true })
    withinProcess = new Set(
      db.prepare('SELECT node_id FROM process_components WHERE process_id = ?').all(proc.id).map((r) => r.node_id)
    )
  }

  // Inside a process, the walk is over the process's own edges. Walking the
  // whole estate and clipping afterwards counts hops through components that
  // are not in the process, so depth=2 could return a node whose only route to
  // the focus went outside and arrives with no edge at all — a node floating
  // unconnected on the overlay — and depth=all made the focus a no-op, because
  // the global walk reaches everything and the clip leaves the whole process.
  // §8: "the existing focus/depth controls still work within that subgraph".
  const walkEdges = withinProcess
    ? allEdges.filter((e) => withinProcess.has(e.from_id) && withinProcess.has(e.to_id))
    : allEdges

  //
  // A focus the process does not contain selects nothing, so the filter stands
  // alone and the whole process comes back — "the process wins as the filter
  // and `focus` only selects", with nothing to select.
  if (focus && (!withinProcess || withinProcess.has(focus))) {
    keep = new Set([focus])
    for (let hop = 0; hop < depth && hop < 12; hop++) {
      // Each hop's finds are collected separately and merged at the end of the
      // pass. Adding them to `keep` as we go would let one pass walk the whole
      // graph, and depth would stop meaning anything.
      const next = new Set()
      for (const e of walkEdges) {
        if (keep.has(e.from_id) === keep.has(e.to_id)) continue
        next.add(keep.has(e.from_id) ? e.to_id : e.from_id)
      }
      if (!next.size) break
      for (const id of next) keep.add(id)
    }
  }

  const nodeRows = db
    .prepare(
      // `degree` per §8's node shape. It is the count over the whole estate,
      // not within the returned subgraph: it answers "how connected is this
      // thing", which does not change with what you are currently looking at.
      `SELECT n.*,
              (SELECT COUNT(*) FROM edges e WHERE e.from_id = n.id OR e.to_id = n.id) AS degree
       FROM nodes n`
    )
    .all()
    .filter((n) => {
      // The process filter is absolute — everything outside it is dropped, not
      // dimmed, and not exempted by being the focus.
      if (withinProcess && !withinProcess.has(n.id)) return false
      if (keep && !keep.has(n.id)) return false
      if (kinds.length && !kinds.includes(n.kind) && n.id !== focus) return false
      if (hideContracts && n.kind === 'contract' && n.id !== focus) return false
      if (repos.length && !repos.includes(n.owner_repo) && n.id !== focus) return false
      if (!includeExternal && (n.orphan || n.kind === 'external') && n.id !== focus) return false
      return true
    })

  const ov = overrideMap('node')
  const nodes = nodeRows.map(nodeRow).map((n) => applyNodeOverrides(n, ov)).filter((n) => !n.hidden || n.id === focus)
  const ids = new Set(nodes.map((n) => n.id))

  res.json({
    nodes,
    edges: allEdges.filter((e) => ids.has(e.from_id) && ids.has(e.to_id)).map(edgeRow),
    process: processCode || null,
  })
}))

/* ───────────────────────────────────────────────────────── overrides */

router.put('/override', wrap(async (req, res) => {
  const { subjectKind, subjectId, field, value, author } = req.body ?? {}
  // The three keys are TEXT columns and go straight into a bind list, so a
  // non-string is rejected rather than reinterpreted: better-sqlite3 reads an
  // object as a named-parameter bag and spreads an array into the positional
  // list, which would write a row nobody asked for and answer 200.
  const str = (v) => typeof v === 'string' && v.trim().length > 0
  if (!str(subjectKind) || !str(subjectId) || !str(field)) {
    return res.status(400).json({ error: 'subjectKind, subjectId and field must be non-empty strings' })
  }
  // `value` is the correction itself and the column is TEXT. A number is
  // stored as text either way; doing it here means "42" rather than SQLite
  // affinity's "42.0", and a null still clears the field.
  if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return res.status(400).json({ error: 'value must be a string, a number, a boolean or null' })
  }
  if (author !== undefined && author !== null && typeof author !== 'string') {
    return res.status(400).json({ error: 'author must be a string or null' })
  }
  const text = value === undefined || value === null ? null : String(value)
  db.prepare(
    `INSERT INTO overrides (subject_kind, subject_id, field, value, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(subject_kind, subject_id, field)
     DO UPDATE SET value = excluded.value, author = excluded.author, updated_at = excluded.updated_at`
  ).run(subjectKind, subjectId, field, text, author ?? null, new Date().toISOString())
  await relink()
  res.json({ ok: true })
}))

router.delete('/override', wrap(async (req, res) => {
  db.prepare(
    'DELETE FROM overrides WHERE subject_kind = ? AND subject_id = ? AND field = ?'
  ).run(String(one(req.query.subjectKind) ?? ''), String(one(req.query.subjectId) ?? ''), String(one(req.query.field) ?? ''))
  await relink()
  res.json({ ok: true })
}))

/**
 * The link pass reads two things that change without an ingest: `overrides`,
 * and `teams.json`. An override on a node's team decides `nodes.team_id`, which
 * decides the team filter, the team lens, every `process_teams` row and
 * `cross_team` on every handoff — so writing the row and stopping would leave
 * `/api/node` showing the correction (overrides are applied at read time) while
 * every derived team column still said the old thing.
 *
 * The pass is global, deterministic and a few hundred rows; it already runs
 * after every ingest, and this is the same class of input change.
 */
async function relink() {
  const { linkPass } = await import('./link.js')
  const { rebuildSearch } = await import('./ingest.js')
  linkPass()
  rebuildSearch()
}

/** For a change the server cannot see: somebody edited `teams.json`. */
router.post('/relink', wrap(async (req, res) => {
  await relink()
  res.json({
    ok: true,
    teams: db.prepare('SELECT COUNT(*) AS n FROM teams WHERE registered = 1').get().n,
    handoffs: db.prepare(`SELECT COUNT(*) AS n FROM process_links WHERE via = 'interaction'`).get().n,
  })
}))

/* ───────────────────────────────────────────────────────── repos & prompts */

router.get('/repos', wrap(async (req, res) => {
  const file = path.join(ROOT, 'repos.json')
  const config = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8'), {}) : {}
  const scanned = new Map(
    db
      .prepare(`SELECT repo, commit_sha, scanned_at, ingested_at FROM manifests WHERE status = 'active'`)
      .all()
      .map((r) => [r.repo, r])
  )
  res.json({
    workspace: config.workspace ?? null,
    configured: fs.existsSync(file),
    repos: (config.repos ?? []).map((r) => {
      const s = scanned.get(r.repo)
      return {
        ...r,
        commit: s?.commit_sha ?? null,
        scannedAt: s?.scanned_at ?? null,
        ingestedAt: s?.ingested_at ?? null,
      }
    }),
  })
}))

/** The scan prompt with {{SCHEMA}} and {{REPO}} filled in, ready to paste. */
/** Which schema a prompt inlines. A process prompt gets the pack schema. */
const PROMPT_SCHEMA = {
  'author-processes': 'process-pack.schema.json',
}

router.get('/prompt', wrap(async (req, res) => {
  const name = String(req.query.name || 'scan-pass1').replace(/[^a-z0-9-]/gi, '')
  const file = path.join(ROOT, 'prompts', `${name}.md`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No such prompt' })
  const schema = fs.readFileSync(
    path.join(ROOT, 'schema', PROMPT_SCHEMA[name] ?? 'manifest.schema.json'),
    'utf8'
  )

  // Every component in the map, and every code already taken. Without these
  // the authoring prompt is useless: its central rule is "only reference
  // components that exist", and it cannot be followed blind.
  const byKind = new Map()
  for (const n of db.prepare('SELECT id, kind, name FROM nodes ORDER BY kind, id').all()) {
    if (!byKind.has(n.kind)) byKind.set(n.kind, [])
    byKind.get(n.kind).push(`- \`${n.id}\` · ${n.name}`)
  }
  const components = byKind.size
    ? [...byKind].map(([kind, lines]) => `**${kind}**\n${lines.join('\n')}`).join('\n\n')
    : '_Nothing has been ingested yet, so there are no components to reference._'

  const taken = db.prepare('SELECT code, name FROM processes ORDER BY sort_key').all()
  const processes = taken.length
    ? taken.map((p) => `- \`L${p.code}\` · ${p.name}`).join('\n')
    : '_No process codes are in use yet._'

  // Every replacement goes in through a function, because in the two-argument
  // string form `$&`, `$\``, `$'`, `$$` and `$1` are expanded as patterns — and
  // these values are a query parameter, a schema file and rows out of the
  // database. A pack id of `$\`` spliced the whole document back into itself.
  const values = {
    SCHEMA: schema,
    REPO: String(one(req.query.repo) || '<repo>'),
    PACK: String(one(req.query.pack) || '<pack>'),
    COMPONENTS: components,
    PROCESSES: processes,
  }
  const fill = (part) => part.replace(/\{\{(SCHEMA|REPO|PACK|COMPONENTS|PROCESSES)\}\}/g, (_, k) => values[k])

  // Every prompt opens with an HTML comment that documents its placeholders by
  // name. Filling those in destroys the legend and pastes a second copy of the
  // schema into the prompt — and an injected value containing `-->` would close
  // the comment early and spill the rest into the text. A capturing split puts
  // the comments at the odd indices, and they are passed through untouched.
  const text = fs
    .readFileSync(file, 'utf8')
    .split(/(<!--[\s\S]*?-->)/)
    .map((part, i) => (i % 2 ? part : fill(part)))
    .join('')
  res.json({ name, text })
}))

/* ───────────────────────────────────────────────────────── ingest */

router.get('/manifests', wrap(async (req, res) => {
  res.json({
    manifests: db
      .prepare(
        `SELECT id, repo, commit_sha, branch, scanned_at, ingested_at, prompt_version,
                producer_kind, service_id, source_file, status, errors
         FROM manifests ORDER BY ingested_at DESC, id DESC LIMIT ?`
      )
      .all(Number(req.query.limit) || 100)
      .map((r) => ({ ...r, errors: parse(r.errors, null) })),
  })
}))

router.post('/ingest', wrap(async (req, res) => {
  const { ingestManifest } = await import('./ingest.js')
  res.json(ingestManifest(req.body, req.body?.repo ? `${req.body.repo}.json` : null))
}))

router.post('/ingest/sweep', wrap(async (req, res) => {
  const { sweepInbox } = await import('./ingest.js')
  res.json({ results: sweepInbox(INBOX_DIR) })
}))

/* ────────────────────────────────────────────── layer B: process packs */

router.post('/ingest/process-pack', wrap(async (req, res) => {
  const { ingestProcessPack } = await import('./processes.js')
  res.json(ingestProcessPack(req.body, req.body?.pack ? `${req.body.pack}.json` : null))
}))

/**
 * The whole tree in one call. It is small — a few dozen rows — and every
 * screen that shows processes wants all of it, so paging it would cost more
 * than it saves.
 */
const processRow = (r) => ({
  id: r.id,
  code: r.code,
  level: r.level,
  parentId: r.parent_id,
  name: r.name,
  description: r.description,
  owner: r.owner,
  actor: r.actor,
  trigger: r.trigger,
  outcome: r.outcome,
  optional: !!r.optional,
  notes: r.notes,
  tags: parse(r.tags, []),
  source: parse(r.source, null),
  packId: r.pack_id,
  node: r.node_id,
  // Kept verbatim whether or not it resolved: an interaction the code does not
  // have still says what the author meant, and hiding it hides the finding.
  edge: r.edge_from ? { id: r.edge_id, from: r.edge_from, kind: r.edge_kind, to: r.edge_to } : null,
  childCount: r.child_count ?? 0,
  componentCount: r.component_count ?? 0,
  // Three separate facts, because they have three separate answers. An
  // interaction whose ends both exist but whose relationship the code does not
  // have is the most interesting case in the tool, and reporting it as "these
  // components do not exist" would be plainly false — both of them are one
  // click away.
  unresolved: {
    node: !!r.node_id && !r.node_known,
    edge: !!r.edge_from && !r.edge_id,
    edgeFrom: !!r.edge_from && !r.edge_from_known,
    edgeTo: !!r.edge_to && !r.edge_to_known,
  },
})

const PROCESS_SELECT = `
  SELECT p.*,
         (SELECT COUNT(*) FROM processes c WHERE c.parent_id = p.id) AS child_count,
         (SELECT COUNT(*) FROM process_components pc WHERE pc.process_id = p.id) AS component_count,
         (SELECT COUNT(*) FROM nodes n WHERE n.id = p.node_id)   AS node_known,
         (SELECT COUNT(*) FROM nodes n WHERE n.id = p.edge_from) AS edge_from_known,
         (SELECT COUNT(*) FROM nodes n WHERE n.id = p.edge_to)   AS edge_to_known
  FROM processes p`

router.get('/processes', wrap(async (req, res) => {
  const where = []
  const args = []
  if (req.query.root) {
    const root = normaliseCode(one(req.query.root))
    // The second half is a LIKE pattern, so the value has to be a code and not
    // just a string: `%` and `_` are wildcards, and a typo containing one used
    // to return a subtree nobody asked for rather than an empty tree.
    if (!/^[1-9][0-9]*(\.[1-9][0-9]*){0,2}$/.test(root)) {
      return res.status(400).json({ error: `\`root\` must be a process code, e.g. 2 or 2.1.1 — got ${root}` })
    }
    where.push('(p.code = ? OR p.code LIKE ?)')
    args.push(root, `${root}.%`)
  }
  if (req.query.maxLevel !== undefined && req.query.maxLevel !== '') {
    // NaN bound into `level <= ?` matches nothing, so `maxLevel=abc` answered
    // with an empty tree rather than saying what was wrong with it.
    const maxLevel = Number(one(req.query.maxLevel))
    if (!Number.isInteger(maxLevel) || maxLevel < 1) {
      return res.status(400).json({ error: '`maxLevel` must be a whole number of 1 or more' })
    }
    where.push('p.level <= ?')
    args.push(maxLevel)
  }
  const owners = list(req.query.owner)
  if (owners.length) {
    where.push(`p.owner IN (${owners.map(() => '?').join(',')})`)
    args.push(...owners)
  }
  res.json({
    processes: db
      .prepare(
        `${PROCESS_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.sort_key LIMIT ?`
      )
      .all(...args, Number(req.query.limit) || 2000)
      .map(processRow),
  })
}))

/** `L2.1.1` and `2.1.1` are the same process; normalise before looking up. */
const normaliseCode = (code) => String(code ?? '').trim().replace(/^[Ll]/, '')

router.get('/process', wrap(async (req, res) => {
  const code = normaliseCode(one(req.query.code))
  const row = db.prepare(`${PROCESS_SELECT} WHERE p.code = ?`).get(code)
  if (!row) return res.status(404).json({ error: 'No such process' })
  const process = processRow(row)

  // Ancestors from the code itself — 2.1.1 → 2.1 → 2 — because the code is the
  // hierarchy and there is no second parent pointer to disagree with it.
  const parts = code.split('.')
  const ancestorCodes = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'))
  const ancestors = ancestorCodes.length
    ? db
        .prepare(`${PROCESS_SELECT} WHERE p.code IN (${ancestorCodes.map(() => '?').join(',')}) ORDER BY p.sort_key`)
        .all(...ancestorCodes)
        .map(processRow)
    : []

  const children = db.prepare(`${PROCESS_SELECT} WHERE p.parent_id = ? ORDER BY p.sort_key`).all(row.id).map(processRow)
  const descendants = db
    .prepare(`${PROCESS_SELECT} WHERE p.code LIKE ? ORDER BY p.sort_key`)
    .all(`${code}.%`)
    .map(processRow)

  const ov = overrideMap('node')
  const components = db
    .prepare(
      `SELECT n.*, c.via FROM process_components c JOIN nodes n ON n.id = c.node_id
       WHERE c.process_id = ? ORDER BY n.kind, n.name`
    )
    .all(row.id)
    .map((r) => ({ ...applyNodeOverrides(nodeRow(r), ov), via: r.via }))

  const edges = db
    .prepare(
      `SELECT e.*, pe.via FROM process_edges pe JOIN edges e ON e.id = pe.edge_id
       WHERE pe.process_id = ? ORDER BY e.from_id, e.kind`
    )
    .all(row.id)
    .map((r) => ({ ...edgeRow(r), via: r.via }))

  res.json({
    process,
    ancestors,
    children,
    descendants,
    components,
    edges,
    // The distinct services across the whole subtree: at level 1 this is the
    // answer to "how many teams does this process cross".
    services: components.filter((c) => c.kind === 'service'),
    drift: db.prepare('SELECT * FROM drift WHERE subject_id = ?').all(row.id).map((r) => ({ ...r, data: parse(r.data, null) })),
    // `source` is JSON in the column and an object everywhere else it is
    // returned — /api/process-packs parses it, processRow parses it, and the
    // declared type says object. This one was handing back the raw string.
    pack: (() => {
      const r = db
        .prepare('SELECT id, pack, name, description, authored_at, ingested_at, source FROM process_packs WHERE id = ?')
        .get(row.pack_id)
      return r ? { ...r, source: parse(r.source, null) } : null
    })(),
  })
}))

/**
 * The join read from the component side: what the estate has, and which
 * documented processes account for it. The question a platform team asks once
 * a quarter and cannot otherwise answer.
 */
router.get('/coverage', wrap(async (req, res) => {
  const kinds = list(req.query.kinds)
  const rows = db
    .prepare(
      `SELECT * FROM nodes
       ${kinds.length ? `WHERE kind IN (${kinds.map(() => '?').join(',')})` : ''}
       ORDER BY kind, name`
    )
    .all(...kinds)

  const byNode = new Map()
  for (const r of db
    .prepare(
      `SELECT c.node_id, p.code, p.name, p.level, c.via
       FROM process_components c JOIN processes p ON p.id = c.process_id
       ORDER BY p.sort_key`
    )
    .all()) {
    if (!byNode.has(r.node_id)) byNode.set(r.node_id, [])
    byNode.get(r.node_id).push({ code: r.code, name: r.name, level: r.level, via: r.via })
  }

  const ov = overrideMap('node')
  res.json({
    components: rows.map((r) => {
      const processes = byNode.get(r.id) ?? []
      return { node: applyNodeOverrides(nodeRow(r), ov), processes, covered: processes.length > 0 }
    }),
  })
}))

router.get('/process-packs', wrap(async (req, res) => {
  res.json({
    packs: db
      .prepare(
        `SELECT p.id, p.pack, p.name, p.description, p.authored_at, p.ingested_at, p.prompt_version,
                p.producer_kind, p.producer_detail, p.source, p.source_file, p.status, p.errors,
                (SELECT COUNT(*) FROM processes x WHERE x.pack_id = p.id) AS processes
         FROM process_packs p ORDER BY p.ingested_at DESC, p.id DESC LIMIT ?`
      )
      .all(Number(req.query.limit) || 100)
      .map((r) => ({ ...r, errors: parse(r.errors, null), source: parse(r.source, null) })),
  })
}))

/* ───────────────────────────────────────────────────────── pages */

const dashboardRow = (r) => ({
  id: r.id,
  name: r.name,
  slug: r.slug || null,
  layout: parse(r.layout, []),
  scope: parse(r.scope, null),
  sortOrder: r.sort_order ?? 0,
  updatedAt: r.updated_at,
})

router.get('/dashboards', wrap(async (req, res) => {
  const rows = db
    .prepare('SELECT id, name, slug, sort_order, updated_at FROM dashboards ORDER BY sort_order, name')
    .all()
  res.json({
    dashboards: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug || null,
      sortOrder: r.sort_order ?? 0,
      updatedAt: r.updated_at,
    })),
  })
}))

/** Persist the sidebar order of pages: sort_order = index. */
router.put('/dashboards/order', wrap(async (req, res) => {
  const ids = req.body?.ids
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' })
  const stmt = db.prepare('UPDATE dashboards SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    ids.forEach((id, idx) => stmt.run(idx, Number(id)))
  })()
  res.json({ ok: true })
}))

router.get('/dashboards/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such page' })
  res.json(dashboardRow(row))
}))

router.post('/dashboards', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim() || 'Untitled page'
  const layout = JSON.stringify(
    req.body?.withDefault ? instantiateLayout(defaultPageLayout()) : req.body?.layout ?? []
  )
  const now = Date.now()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM dashboards').get().m
  const info = db
    .prepare('INSERT INTO dashboards (name, layout, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, layout, max + 1, now, now)
  res.json(dashboardRow(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(info.lastInsertRowid)))
}))

router.put('/dashboards/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such page' })
  const name = req.body?.name !== undefined ? String(req.body.name).trim() || row.name : row.name
  const layout = req.body?.layout !== undefined ? JSON.stringify(req.body.layout) : row.layout
  const scope = req.body?.scope !== undefined ? JSON.stringify(req.body.scope) : row.scope
  db.prepare('UPDATE dashboards SET name = ?, layout = ?, scope = ?, updated_at = ? WHERE id = ?')
    .run(name, layout, scope, Date.now(), row.id)
  res.json(dashboardRow(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(row.id)))
}))

router.delete('/dashboards/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT slug FROM dashboards WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such page' })
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
}))

router.post('/dashboards/:id/reset', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such page' })
  const template = row.slug ? templateFor(row.slug) : null
  const layout = template ? template.layout : instantiateLayout(defaultPageLayout())
  db.prepare('UPDATE dashboards SET name = ?, layout = ?, updated_at = ? WHERE id = ?')
    .run(template?.name ?? row.name, JSON.stringify(layout), Date.now(), row.id)
  res.json(dashboardRow(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(row.id)))
}))

router.get('/default-layout', wrap(async (req, res) => {
  res.json({ layout: defaultPageLayout() })
}))

router.put('/default-layout', wrap(async (req, res) => {
  if (!Array.isArray(req.body?.layout)) return res.status(400).json({ error: 'layout must be an array' })
  setConfig('default_layout', req.body.layout.map(({ i, ...w }) => w))
  res.json({ ok: true })
}))

router.get('/config/:key', wrap(async (req, res) => {
  res.json({ key: req.params.key, value: getConfig(req.params.key, null) })
}))
