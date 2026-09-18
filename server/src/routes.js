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

const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

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
    },
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
    lastIngestAt:
      db.prepare('SELECT MAX(ingested_at) AS t FROM manifests').get().t ?? null,
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

  const bindings = db
    .prepare(
      row.kind === 'contract'
        ? 'SELECT * FROM contract_bindings WHERE contract_id = ?'
        : 'SELECT * FROM contract_bindings WHERE service_id = ?'
    )
    .all(id)

  const neighbourIds = [...new Set([...out.map((e) => e.to), ...into.map((e) => e.from)])]
  const neighbours = neighbourIds.length
    ? db
        .prepare(`SELECT * FROM nodes WHERE id IN (${neighbourIds.map(() => '?').join(',')})`)
        .all(...neighbourIds)
        .map(nodeRow)
        .map((n) => applyNodeOverrides(n, ov))
    : []

  res.json({
    node,
    out,
    in: into,
    evidence,
    bindings,
    neighbours,
    drift: db.prepare('SELECT * FROM drift WHERE subject_id = ?').all(id),
  })
}))

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
  if (req.query.kind) {
    where.push('kind = ?')
    args.push(req.query.kind)
  }
  if (req.query.severity) {
    where.push('severity = ?')
    args.push(req.query.severity)
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

router.get('/search', wrap(async (req, res) => {
  const q = ftsQuery(req.query.q ?? '')
  if (!q) return res.json({ hits: [] })
  try {
    const rows = db
      .prepare(
        `SELECT subject_kind, subject_id, title, repo,
                snippet(search_index, 3, '<mark>', '</mark>', '…', 12) AS excerpt
         FROM search_index WHERE search_index MATCH ?
         ORDER BY bm25(search_index) LIMIT ?`
      )
      .all(q, Number(req.query.limit) || 50)
    res.json({ hits: rows })
  } catch {
    // A malformed query is an empty result, never a 500.
    res.json({ hits: [] })
  }
}))

/* ───────────────────────────────────────────────────────── graph */

router.get('/graph', wrap(async (req, res) => {
  const focus = String(req.query.focus || '')
  const asked = Number(req.query.depth)
  // 'all' and 0 both mean the whole connected component; anything else is a
  // hop count, defaulting to the focus plus its direct neighbours.
  const depth =
    req.query.depth === 'all' || asked === 0 ? Infinity : Number.isFinite(asked) && asked > 0 ? asked : 1
  const kinds = list(req.query.kinds)
  const includeExternal = req.query.includeExternal !== 'false'

  const allEdges = db.prepare('SELECT * FROM edges').all()
  let keep = null

  if (focus) {
    keep = new Set([focus])
    for (let hop = 0; hop < depth && hop < 12; hop++) {
      // Each hop's finds are collected separately and merged at the end of the
      // pass. Adding them to `keep` as we go would let one pass walk the whole
      // graph, and depth would stop meaning anything.
      const next = new Set()
      for (const e of allEdges) {
        if (keep.has(e.from_id) === keep.has(e.to_id)) continue
        next.add(keep.has(e.from_id) ? e.to_id : e.from_id)
      }
      if (!next.size) break
      for (const id of next) keep.add(id)
    }
  }

  const nodeRows = db.prepare('SELECT * FROM nodes').all().filter((n) => {
    if (keep && !keep.has(n.id)) return false
    if (kinds.length && !kinds.includes(n.kind) && n.id !== focus) return false
    if (!includeExternal && (n.orphan || n.kind === 'external') && n.id !== focus) return false
    return true
  })

  const ov = overrideMap('node')
  const nodes = nodeRows.map(nodeRow).map((n) => applyNodeOverrides(n, ov)).filter((n) => !n.hidden || n.id === focus)
  const ids = new Set(nodes.map((n) => n.id))

  res.json({
    nodes,
    edges: allEdges.filter((e) => ids.has(e.from_id) && ids.has(e.to_id)).map(edgeRow),
  })
}))

/* ───────────────────────────────────────────────────────── overrides */

router.put('/override', wrap(async (req, res) => {
  const { subjectKind, subjectId, field, value, author } = req.body ?? {}
  if (!subjectKind || !subjectId || !field) {
    return res.status(400).json({ error: 'subjectKind, subjectId and field are required' })
  }
  db.prepare(
    `INSERT INTO overrides (subject_kind, subject_id, field, value, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(subject_kind, subject_id, field)
     DO UPDATE SET value = excluded.value, author = excluded.author, updated_at = excluded.updated_at`
  ).run(subjectKind, subjectId, field, value ?? null, author ?? null, new Date().toISOString())
  res.json({ ok: true })
}))

router.delete('/override', wrap(async (req, res) => {
  db.prepare(
    'DELETE FROM overrides WHERE subject_kind = ? AND subject_id = ? AND field = ?'
  ).run(req.query.subjectKind, req.query.subjectId, req.query.field)
  res.json({ ok: true })
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
router.get('/prompt', wrap(async (req, res) => {
  const name = String(req.query.name || 'scan-pass1').replace(/[^a-z0-9-]/gi, '')
  const file = path.join(ROOT, 'prompts', `${name}.md`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No such prompt' })
  const schema = fs.readFileSync(path.join(ROOT, 'schema', 'manifest.schema.json'), 'utf8')
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\{\{SCHEMA\}\}/g, schema)
    .replace(/\{\{REPO\}\}/g, String(req.query.repo || '<repo>'))
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
