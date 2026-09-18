import express from 'express'
import { db, getConfig, setConfig } from './db.js'
import { WEB_ORIGIN } from './config.js'
import {
  authStatus,
  buildAuthUrl,
  consumeState,
  exchangeCode,
  disconnect,
  fetchAccessibleResources,
  setCredentials,
  activeCloudId,
} from './oauth.js'
import { runSync, syncStatus, cancelSync } from './sync.js'
import { templateFor, defaultPageLayout, instantiateLayout } from './pageTemplates.js'
import {
  resolveScope,
  summarise,
  categoryOf,
  workItems,
  categoryOverrides,
  categoryForStatusName,
  invalidateCategoryOverrides,
  cumulativeFlow,
  buildTree,
  sankey,
  peopleBreakdown,
  throughput,
  chordFlows,
  cycleTime,
  breakdown,
  crosstab,
  timeseries,
  graphData,
  burnup,
  graphTimeline,
  SANKEY_DIMENSIONS,
  METRICS,
} from './reports.js'

export const router = express.Router()

const csv = (v) =>
  typeof v === 'string' && v.length ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

function scopeFrom(query) {
  return resolveScope({
    projects: csv(query.projects),
    roots: csv(query.roots),
    types: csv(query.types),
    statuses: csv(query.statuses),
    excludeDone: query.excludeDone === 'true',
    descendants: query.descendants !== 'false',
    followLinks: query.followLinks === 'true',
  })
}

/** Time window for snapshot reports: keep issues touched since `from`. */
const activeSince = (issues, from) =>
  from ? issues.filter((i) => (i.updated || i.created || '') >= from) : issues

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500
      res.status(status).json({ error: String(err.message || err) })
    }
  }
}

/* ------------------------------------------------------------------- auth */

router.get('/auth/status', (req, res) => res.json(authStatus()))

router.post('/auth/credentials', wrap(async (req, res) => {
  const { clientId, clientSecret, redirectUri, scopes } = req.body || {}
  setCredentials({ clientId, clientSecret, redirectUri, scopes })
  res.json(authStatus())
}))

router.get('/auth/login', wrap(async (req, res) => {
  res.redirect(buildAuthUrl())
}))

router.get('/auth/callback', async (req, res) => {
  const back = (params) => res.redirect(`${WEB_ORIGIN}/settings?${new URLSearchParams(params)}`)
  try {
    if (req.query.error) return back({ error: String(req.query.error_description || req.query.error) })
    if (!consumeState(String(req.query.state || ''))) {
      return back({ error: 'OAuth state mismatch — start the connection again' })
    }
    await exchangeCode(String(req.query.code))
    await fetchAccessibleResources()
    return back({ connected: '1' })
  } catch (err) {
    return back({ error: String(err.message || err) })
  }
})

router.post('/auth/disconnect', wrap(async (req, res) => {
  disconnect()
  res.json(authStatus())
}))

/* ------------------------------------------------------------------ sites */

router.get('/sites', wrap(async (req, res) => {
  const rows = db.prepare('SELECT * FROM sites').all()
  res.json({ sites: rows, active: activeCloudId() })
}))

router.post('/sites/refresh', wrap(async (req, res) => {
  const sites = await fetchAccessibleResources()
  res.json({ sites, active: activeCloudId() })
}))

router.post('/sites/select', wrap(async (req, res) => {
  setConfig('cloud_id', req.body?.cloudId)
  res.json({ active: activeCloudId() })
}))

/* --------------------------------------------------------------- projects */

router.get('/projects', wrap(async (req, res) => {
  const cloudId = activeCloudId()
  const rows = cloudId
    ? db.prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM issues i WHERE i.cloud_id = p.cloud_id AND i.project_id = p.id) AS issue_count
         FROM projects p WHERE p.cloud_id = ? ORDER BY p.key`
      ).all(cloudId)
    : []
  res.json({ projects: rows, selected: getConfig('sync_projects', []) })
}))

router.post('/projects/select', wrap(async (req, res) => {
  setConfig('sync_projects', req.body?.keys || [])
  res.json({ selected: getConfig('sync_projects', []) })
}))

/* ------------------------------------------------------------------- sync */

router.post('/sync', wrap(async (req, res) => {
  if (syncStatus().running) return res.status(409).json({ error: 'A sync is already running' })
  const mode = req.body?.mode === 'full' ? 'full' : 'incremental'
  if (mode === 'full') setConfig('last_issue_sync', null)
  // Fire and forget; the client polls /sync/status, which also surfaces errors.
  runSync({ mode }).catch((err) => console.error('[sync]', err))
  res.json({ started: true, mode })
}))

router.get('/sync/status', (req, res) => res.json(syncStatus()))

router.post('/sync/cancel', wrap(async (req, res) => {
  res.json({ cancelled: cancelSync() })
}))

/* ---------------------------------------------------------------- catalog */

router.get('/catalog', wrap(async (req, res) => {
  const cloudId = activeCloudId()
  if (!cloudId) return res.json({ ready: false })

  const levels = db.prepare(
    `SELECT hierarchy_level AS level, type_name AS name, COUNT(*) AS n
     FROM issues WHERE cloud_id = ? GROUP BY hierarchy_level, type_name ORDER BY level DESC, n DESC`
  ).all(cloudId)

  const statuses = db.prepare(
    `SELECT status_name AS name, status_category AS category, COUNT(*) AS n
     FROM issues WHERE cloud_id = ? GROUP BY status_name, status_category ORDER BY n DESC`
  ).all(cloudId)
    // Labels follow the effective (user-mapped) category, not Jira's raw one.
    .map((s) => ({ ...s, category: categoryForStatusName(s.name, s.category) }))

  const projects = db.prepare(
    `SELECT key, name, type_key, n FROM (
       SELECT p.key, p.name, p.type_key,
              (SELECT COUNT(*) FROM issues i WHERE i.cloud_id = p.cloud_id AND i.project_id = p.id) AS n
       FROM projects p WHERE p.cloud_id = ?
     ) WHERE n > 0 ORDER BY key`
  ).all(cloudId)

  const totals = db.prepare(
    'SELECT COUNT(*) AS issues, MAX(updated) AS newest FROM issues WHERE cloud_id = ?'
  ).get(cloudId)

  res.json({
    ready: totals.issues > 0,
    levels,
    statuses,
    projects,
    totals,
    metrics: Object.entries(METRICS).map(([k, v]) => ({ key: k, label: v.label })),
    dimensions: SANKEY_DIMENSIONS,
  })
}))

/**
 * Selectable report roots: initiatives, epics and Product Discovery ideas.
 * `level` filters the hierarchy tier; `q` is a substring match on key/summary.
 */
router.get('/roots', wrap(async (req, res) => {
  const cloudId = activeCloudId()
  if (!cloudId) return res.json({ roots: [] })

  const level = req.query.level
  const q = String(req.query.q || '').trim()
  const limit = Math.min(Number(req.query.limit) || 300, 1000)

  const where = ['i.cloud_id = ?']
  const params = [cloudId]

  if (level === 'idea') {
    where.push(`p.type_key = 'product_discovery'`)
  } else if (level !== undefined && level !== '' && level !== 'any') {
    where.push('i.hierarchy_level = ?')
    params.push(Number(level))
  }
  if (q) {
    where.push('(i.key LIKE ? OR i.summary LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }

  const roots = db.prepare(
    `SELECT i.id, i.key, i.summary, i.type_name, i.hierarchy_level, i.status_name,
            i.status_category, i.project_key, p.type_key AS project_type,
            (SELECT COUNT(*) FROM issues c WHERE c.cloud_id = i.cloud_id AND c.parent_id = i.id) AS child_count
     FROM issues i
     LEFT JOIN projects p ON p.cloud_id = i.cloud_id AND p.id = i.project_id
     WHERE ${where.join(' AND ')}
     ORDER BY child_count DESC, i.key
     LIMIT ?`
  ).all(...params, limit)

  res.json({ roots })
}))

/* ---------------------------------------------------------------- reports */

router.get('/reports/summary', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const metric = req.query.metric || 'count'
  res.json({
    ...summarise(issues, metric),
    throughput: throughput({
      issues,
      weeks: Number(req.query.weeks) || 12,
      from: req.query.from,
      state: String(req.query.throughputState || '') || undefined,
    }),
  })
}))

router.get('/reports/cfd', wrap(async (req, res) => {
  const { issues, cloudId } = scopeFrom(req.query)
  let set = issues
  if (req.query.leavesOnly === 'true') {
    // Anything that is somebody's parent within this scope is not a leaf.
    const parents = new Set(issues.map((i) => i.parent_id).filter(Boolean))
    set = issues.filter((i) => !parents.has(i.id))
  }
  res.json(
    cumulativeFlow({
      issues: set,
      cloudId,
      from: req.query.from,
      to: req.query.to,
      groupBy: req.query.groupBy === 'category' ? 'category' : 'status',
      metric: req.query.metric || 'count',
      mergeDone: req.query.mergeDone !== 'false',
    })
  )
}))

router.get('/reports/tree', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const tree = buildTree({ issues, metric: req.query.metric || 'count' })
  res.json({ tree, issueCount: issues.length })
}))

router.get('/reports/sankey', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const dims = csv(req.query.dimensions)
  res.json(
    sankey({
      issues: activeSince(issues, req.query.from),
      dimensions: dims.length ? dims : ['assignee', 'epic', 'category'],
      metric: req.query.metric || 'count',
      maxPerColumn: Math.min(Number(req.query.maxPerColumn) || 12, 24),
    })
  )
}))

router.get('/reports/breakdown', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  res.json(
    breakdown({
      issues: activeSince(issues, req.query.from),
      groupBy: String(req.query.groupBy || 'assignee'),
      metric: req.query.metric || 'count',
      max: Math.min(Number(req.query.max) || 30, 100),
    })
  )
}))

router.get('/reports/crosstab', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  res.json(
    crosstab({
      issues: activeSince(issues, req.query.from),
      groupBy: String(req.query.groupBy || 'project'),
      stackBy: String(req.query.stackBy || 'type'),
      metric: req.query.metric || 'count',
      maxGroups: Math.min(Number(req.query.maxGroups) || 30, 100),
      maxStacks: Math.min(Number(req.query.maxStacks) || 8, 8),
    })
  )
}))

router.get('/reports/timeseries', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  res.json(
    timeseries({
      issues,
      groupBy: String(req.query.groupBy || 'assignee'),
      metric: req.query.metric || 'count',
      mode: req.query.mode === 'created' ? 'created' : 'completed',
      accumulate: req.query.accumulate !== 'false',
      from: req.query.from,
      maxGroups: Math.min(Number(req.query.maxGroups) || 6, 12),
    })
  )
}))

router.get('/reports/people', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  res.json({
    people: peopleBreakdown({
      issues: activeSince(issues, req.query.from),
      metric: req.query.metric || 'count',
    }),
  })
}))

const issueRow = (i) => ({
  key: i.key,
  summary: i.summary,
  type: i.type_name,
  level: i.hierarchy_level,
  status: i.status_name,
  category: categoryOf(i),
  assignee: i.assignee_name,
  project: i.project_key,
  points: i.story_points,
  hours: (i.time_spent || 0) / 3600,
  created: i.created,
  updated: i.updated,
  resolved: i.resolved,
  parent: i.parent_key,
})

const byUpdatedDesc = (a, b) => (b.updated || '').localeCompare(a.updated || '')

router.get('/reports/issues', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const limit = Math.min(Number(req.query.limit) || 500, 5000)
  res.json({
    total: issues.length,
    issues: issues.slice().sort(byUpdatedDesc).slice(0, limit).map(issueRow),
  })
}))

/**
 * What the burn-down still counts as open: the scope's work items (leaves)
 * whose mapped category is not done — the chart's last value, itemised.
 */
router.get('/reports/remaining', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const open = workItems(issues).filter((i) => categoryOf(i) !== 'done')
  res.json({
    total: open.length,
    points: open.reduce((s, i) => s + (i.story_points || 0), 0),
    issues: open.sort(byUpdatedDesc).map(issueRow),
  })
}))

router.get('/reports/chord', wrap(async (req, res) => {
  const { issues, cloudId } = scopeFrom(req.query)
  res.json(
    chordFlows({
      issues: activeSince(issues, req.query.from),
      cloudId,
      flow: req.query.flow === 'projects' ? 'projects' : 'handovers',
      maxEntities: Math.min(Number(req.query.maxEntities) || 8, 8),
    })
  )
}))

router.get('/reports/cycletime', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const groupBy = ['epic', 'assignee', 'project'].includes(req.query.groupBy)
    ? req.query.groupBy
    : 'epic'
  res.json(cycleTime({ issues, groupBy, from: req.query.from }))
}))

router.get('/reports/graph', wrap(async (req, res) => {
  const { issues } = scopeFrom(req.query)
  const depth = ['initiatives', 'epics', 'stories'].includes(req.query.depth)
    ? req.query.depth
    : req.query.includeStories === 'true'
      ? 'stories'
      : 'epics'
  res.json(
    graphData({
      issues,
      depth,
      maxStories: Math.min(Number(req.query.maxStories) || 120, 300),
    })
  )
}))

router.get('/reports/burnup', wrap(async (req, res) => {
  const { issues, cloudId } = scopeFrom(req.query)
  res.json(
    burnup({
      issues,
      cloudId,
      metric: req.query.metric || 'count',
      from: req.query.from,
    })
  )
}))

/**
 * The tracked date fields for the selected epics/initiatives (page roots),
 * falling back to the containers in scope when nothing is selected.
 */
router.get('/reports/epic-dates', wrap(async (req, res) => {
  const cloudId = activeCloudId()
  if (!cloudId) return res.json({ epics: [] })
  const keys = csv(req.query.roots)

  let rows
  if (keys.length) {
    rows = db
      .prepare(
        `SELECT * FROM issues WHERE cloud_id = ? AND key IN (${keys.map(() => '?').join(',')})`
      )
      .all(cloudId, ...keys)
    // Preserve the selection order.
    rows.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))
  } else {
    const { issues } = scopeFrom(req.query)
    rows = issues
      .filter((i) => i.hierarchy_level >= 1)
      .sort((a, b) => a.hierarchy_level - b.hierarchy_level || a.key.localeCompare(b.key))
      .slice(0, 12)
  }

  res.json({
    epics: rows.map((i) => ({
      key: i.key,
      summary: i.summary,
      status: i.status_name,
      category: categoryOf(i),
      fields: i.custom_fields ? JSON.parse(i.custom_fields) : {},
    })),
  })
}))

router.get('/reports/graph-timeline', wrap(async (req, res) => {
  const { issues, cloudId } = scopeFrom(req.query)
  res.json(
    graphTimeline({
      issues,
      cloudId,
      maxStories: Math.min(Number(req.query.maxStories) || 250, 500),
    })
  )
}))

/* ------------------------------------------------------------- dashboards */

const dashboardRow = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug || null,
  layout: JSON.parse(row.layout || '[]'),
  scope: row.scope ? JSON.parse(row.scope) : null,
  updatedAt: row.updated_at,
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

/** Persist the sidebar order of (custom) pages: sort_order = index. */
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
  if (!row) return res.status(404).json({ error: 'No such dashboard' })
  res.json(dashboardRow(row))
}))

router.post('/dashboards', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim() || 'Untitled dashboard'
  const layout = JSON.stringify(
    req.body?.withDefault ? instantiateLayout(defaultPageLayout()) : req.body?.layout ?? []
  )
  const now = Date.now()
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM dashboards').get().m
  const info = db
    .prepare('INSERT INTO dashboards (name, layout, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, layout, max + 1, now, now)
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(info.lastInsertRowid)
  res.json(dashboardRow(row))
}))

router.put('/dashboards/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such dashboard' })
  const name = req.body?.name !== undefined ? String(req.body.name).trim() || row.name : row.name
  const layout = req.body?.layout !== undefined ? JSON.stringify(req.body.layout) : row.layout
  const scope = req.body?.scope !== undefined ? JSON.stringify(req.body.scope) : row.scope
  db.prepare('UPDATE dashboards SET name = ?, layout = ?, scope = ?, updated_at = ? WHERE id = ?')
    .run(name, layout, scope, Date.now(), row.id)
  res.json(dashboardRow(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(row.id)))
}))

/* --------------------------------------------------------- status mapping */

/** Every synced status with Jira's category, the effective one, and any override. */
router.get('/status-mapping', wrap(async (req, res) => {
  const cloudId = activeCloudId()
  const rows = cloudId
    ? db
        .prepare(
          `SELECT status_name AS name, status_category AS category, COUNT(*) AS n
           FROM issues WHERE cloud_id = ? AND status_name IS NOT NULL
           GROUP BY status_name, status_category ORDER BY n DESC`
        )
        .all(cloudId)
    : []
  const overrides = categoryOverrides()
  res.json({
    statuses: rows.map((r) => ({
      name: r.name,
      jiraCategory: r.category,
      effective: categoryForStatusName(r.name, r.category),
      override: overrides[r.name.trim().toLowerCase()] ?? null,
      count: r.n,
    })),
  })
}))

/** Replace the override map: { "QA Done": "done", ... }; null values clear. */
router.put('/status-mapping', wrap(async (req, res) => {
  const incoming = req.body?.overrides
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'overrides must be an object of status -> category' })
  }
  const valid = new Set(['new', 'indeterminate', 'done'])
  const cleaned = {}
  for (const [name, cat] of Object.entries(incoming)) {
    if (cat !== null && valid.has(cat)) cleaned[name] = cat
  }
  setConfig('status_category_overrides', cleaned)
  invalidateCategoryOverrides()
  res.json({ ok: true })
}))

/* ---------------------------------------------------------- saved filters */

router.get('/filters', wrap(async (req, res) => {
  res.json({ filters: getConfig('saved_filters', []) })
}))

/** Upsert by name: saving under an existing name replaces it. */
router.post('/filters', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'A filter needs a name' })
  const scope = req.body?.scope
  if (!scope || typeof scope !== 'object') return res.status(400).json({ error: 'A filter needs a scope' })
  const filters = getConfig('saved_filters', []).filter((f) => f.name !== name)
  filters.push({ name, scope })
  filters.sort((a, b) => a.name.localeCompare(b.name))
  setConfig('saved_filters', filters)
  res.json({ filters })
}))

router.delete('/filters/:name', wrap(async (req, res) => {
  const filters = getConfig('saved_filters', []).filter((f) => f.name !== req.params.name)
  setConfig('saved_filters', filters)
  res.json({ filters })
}))

router.delete('/dashboards/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT slug FROM dashboards WHERE id = ?').get(req.params.id)
  if (row?.slug) return res.status(400).json({ error: 'Built-in pages cannot be deleted — reset them instead' })
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
}))

/** Restore a page's layout: built-ins to their template, custom pages to the default layout. */
router.post('/dashboards/:id/reset', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such dashboard' })
  const template = row.slug ? templateFor(row.slug) : null
  const name = template ? template.name : row.name
  const layout = template ? template.layout : instantiateLayout(defaultPageLayout())
  db.prepare('UPDATE dashboards SET name = ?, layout = ?, updated_at = ? WHERE id = ?')
    .run(name, JSON.stringify(layout), Date.now(), row.id)
  res.json(dashboardRow(db.prepare('SELECT * FROM dashboards WHERE id = ?').get(row.id)))
}))

/* ---------------------------------------------------------- default layout */

router.get('/default-layout', wrap(async (req, res) => {
  res.json({ layout: defaultPageLayout(), custom: !!getConfig('default_layout', null) })
}))

/** Save (or clear, with null) the default layout new pages and resets use. */
router.put('/default-layout', wrap(async (req, res) => {
  const layout = req.body?.layout
  if (layout === null) {
    setConfig('default_layout', null)
  } else if (Array.isArray(layout) && layout.length) {
    setConfig('default_layout', layout)
  } else {
    return res.status(400).json({ error: 'layout must be a non-empty array, or null to restore the shipped default' })
  }
  res.json({ layout: defaultPageLayout(), custom: !!getConfig('default_layout', null) })
}))

/* --------------------------------------------------------- weekly status */

const mondayOf = (input) => {
  const d = input ? new Date(`${input}T00:00:00Z`) : new Date()
  if (Number.isNaN(+d)) return mondayOf()
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
    .toISOString()
    .slice(0, 10)
}

const teamIdsFor = db.prepare('SELECT team_id FROM initiative_teams WHERE initiative_id = ?')

const initiativeRow = (row) => ({
  id: row.id,
  title: row.title,
  jiraKey: row.jira_key || null,
  archived: !!row.archived,
  teamIds: teamIdsFor.all(row.id).map((r) => r.team_id),
})

function setInitiativeTeams(initiativeId, teamIds) {
  db.prepare('DELETE FROM initiative_teams WHERE initiative_id = ?').run(initiativeId)
  const insert = db.prepare('INSERT OR IGNORE INTO initiative_teams (initiative_id, team_id) VALUES (?, ?)')
  for (const id of teamIds || []) insert.run(initiativeId, Number(id))
}

/** Tracked epic fields (report dates, HL estimation) for a linked issue. */
function trackedFieldsFor(jiraKey) {
  if (!jiraKey) return null
  const cloudId = activeCloudId()
  if (!cloudId) return null
  const row = db
    .prepare('SELECT custom_fields FROM issues WHERE cloud_id = ? AND key = ?')
    .get(cloudId, jiraKey)
  if (!row?.custom_fields) return null
  try {
    const parsed = JSON.parse(row.custom_fields)
    return Object.keys(parsed).length ? parsed : null
  } catch {
    return null
  }
}

/** Live rollup for a Jira-linked workstream, from the synced local data. */
function progressFor(jiraKey) {
  if (!jiraKey) return null
  try {
    const { issues } = resolveScope({ projects: [], roots: [jiraKey], types: [], descendants: true, followLinks: false })
    if (!issues.length) return null
    const s = summarise(issues, 'count')
    return { pct: s.percentComplete, done: s.counts.done || 0, total: s.issues }
  } catch {
    return null
  }
}

function reportPayload(report) {
  const prevReport = db
    .prepare('SELECT * FROM status_reports WHERE week < ? ORDER BY week DESC LIMIT 1')
    .get(report.week)
  const prevKey = (e) => `${e.initiative_id}:${e.team_id ?? 'none'}`
  const prevEntries = new Map(
    prevReport
      ? db.prepare('SELECT * FROM report_entries WHERE report_id = ?').all(prevReport.id).map((e) => [prevKey(e), e])
      : []
  )
  const entries = db
    .prepare(
      `SELECT e.*, i.title, i.jira_key AS initiative_key
       FROM report_entries e JOIN initiatives i ON i.id = e.initiative_id
       WHERE e.report_id = ? ORDER BY e.sort_order, i.title`
    )
    .all(report.id)
    .map((e) => {
      const prev = prevEntries.get(prevKey(e))
      const effectiveKey = e.jira_key || e.initiative_key || null
      return {
        id: e.id,
        initiativeId: e.initiative_id,
        teamId: e.team_id ?? null,
        title: e.title,
        jiraKey: effectiveKey,
        rag: e.rag || 'on-track',
        updateText: e.update_text || '',
        targetDate: e.target_date || null,
        prev: prev
          ? { rag: prev.rag || 'on-track', targetDate: prev.target_date || null, updateText: prev.update_text || '' }
          : null,
        progress: progressFor(effectiveKey),
        fields: trackedFieldsFor(effectiveKey),
      }
    })
  return { id: report.id, week: report.week, prevWeek: prevReport?.week ?? null, entries }
}

/* teams */

router.get('/teams', wrap(async (req, res) => {
  res.json({
    teams: db.prepare('SELECT * FROM teams ORDER BY sort_order, name').all().map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sort_order,
      archived: !!t.archived,
    })),
  })
}))

router.post('/teams', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'A team needs a name' })
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM teams').get().m
  const info = db.prepare('INSERT INTO teams (name, sort_order) VALUES (?, ?)').run(name, max + 1)
  res.json({ id: info.lastInsertRowid, name, sortOrder: max + 1, archived: false })
}))

router.put('/teams/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such team' })
  const name = req.body?.name !== undefined ? String(req.body.name).trim() || row.name : row.name
  const archived = req.body?.archived !== undefined ? (req.body.archived ? 1 : 0) : row.archived
  db.prepare('UPDATE teams SET name = ?, archived = ? WHERE id = ?').run(name, archived, row.id)
  res.json({ id: row.id, name, sortOrder: row.sort_order, archived: !!archived })
}))

/** Hard delete is allowed only for teams no report has ever used. */
router.delete('/teams/:id', wrap(async (req, res) => {
  const used = db
    .prepare('SELECT COUNT(*) AS n FROM report_entries WHERE team_id = ?')
    .get(req.params.id).n
  if (used > 0) {
    return res.status(400).json({ error: 'This team appears in reports — archive it instead' })
  }
  db.prepare('DELETE FROM initiative_teams WHERE team_id = ?').run(req.params.id)
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
}))

/* initiatives (reportable workstreams) */

router.get('/initiatives', wrap(async (req, res) => {
  res.json({
    initiatives: db.prepare('SELECT * FROM initiatives ORDER BY title').all().map(initiativeRow),
  })
}))

router.post('/initiatives', wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'An initiative needs a title' })
  const jiraKey = String(req.body?.jiraKey || '').trim() || null
  const info = db
    .prepare('INSERT INTO initiatives (title, jira_key, created_at) VALUES (?, ?, ?)')
    .run(title, jiraKey, Date.now())
  setInitiativeTeams(info.lastInsertRowid, req.body?.teamIds)
  res.json(initiativeRow(db.prepare('SELECT * FROM initiatives WHERE id = ?').get(info.lastInsertRowid)))
}))

router.put('/initiatives/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such initiative' })
  const title = req.body?.title !== undefined ? String(req.body.title).trim() || row.title : row.title
  const jiraKey =
    req.body?.jiraKey !== undefined ? String(req.body.jiraKey).trim() || null : row.jira_key
  const archived = req.body?.archived !== undefined ? (req.body.archived ? 1 : 0) : row.archived
  db.prepare('UPDATE initiatives SET title = ?, jira_key = ?, archived = ? WHERE id = ?')
    .run(title, jiraKey, archived, row.id)
  if (req.body?.teamIds !== undefined) setInitiativeTeams(row.id, req.body.teamIds)
  res.json(initiativeRow(db.prepare('SELECT * FROM initiatives WHERE id = ?').get(row.id)))
}))

/** Merge text/status/date/key from a source entry into a surviving one. */
function mergedEntryValues(target, src) {
  const tText = (target.update_text || '').trim()
  const sText = (src.update_text || '').trim()
  const updateText = !tText ? sText : sText && !tText.includes(sText) ? `${tText}\n${sText}` : tText
  return {
    updateText,
    rag: target.rag && target.rag !== 'on-track' ? target.rag : src.rag || target.rag || 'on-track',
    targetDate: target.target_date || src.target_date || null,
    jiraKey: target.jira_key || src.jira_key || null,
  }
}

const applyEntryValues = db.prepare(
  'UPDATE report_entries SET update_text = ?, rag = ?, target_date = ?, jira_key = ? WHERE id = ?'
)

/**
 * Fold one workstream into another, across all weeks. Entries move to the
 * target; where the target already reports for the same week and team, the
 * two entries merge and the source entry is dropped.
 */
router.post('/initiatives/:id/merge', wrap(async (req, res) => {
  const source = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(req.params.id)
  const target = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(Number(req.body?.into))
  if (!source || !target) return res.status(404).json({ error: 'No such workstream' })
  if (source.id === target.id) return res.status(400).json({ error: 'Cannot merge a workstream into itself' })

  db.transaction(() => {
    const srcEntries = db.prepare('SELECT * FROM report_entries WHERE initiative_id = ?').all(source.id)
    for (const e of srcEntries) {
      const existing = db
        .prepare(
          'SELECT * FROM report_entries WHERE report_id = ? AND team_id IS ? AND initiative_id = ?'
        )
        .get(e.report_id, e.team_id, target.id)
      if (existing) {
        const m = mergedEntryValues(existing, e)
        applyEntryValues.run(m.updateText, m.rag, m.targetDate, m.jiraKey, existing.id)
        db.prepare('DELETE FROM report_entries WHERE id = ?').run(e.id)
      } else {
        db.prepare('UPDATE report_entries SET initiative_id = ? WHERE id = ?').run(target.id, e.id)
      }
    }
    if (!target.jira_key && source.jira_key) {
      db.prepare('UPDATE initiatives SET jira_key = ? WHERE id = ?').run(source.jira_key, target.id)
    }
    db.prepare('DELETE FROM initiative_teams WHERE initiative_id = ?').run(source.id)
    db.prepare('DELETE FROM initiatives WHERE id = ?').run(source.id)
  })()
  res.json({ ok: true, targetId: target.id })
}))

/* weekly reports */

router.get('/status-reports', wrap(async (req, res) => {
  res.json({
    reports: db
      .prepare(
        `SELECT r.id, r.week, (SELECT COUNT(*) FROM report_entries e WHERE e.report_id = r.id) AS n
         FROM status_reports r ORDER BY r.week DESC`
      )
      .all()
      .map((r) => ({ id: r.id, week: r.week, entryCount: r.n })),
  })
}))

router.get('/status-reports/:week', wrap(async (req, res) => {
  const report = db.prepare('SELECT * FROM status_reports WHERE week = ?').get(mondayOf(req.params.week))
  if (!report) return res.status(404).json({ error: 'No report for that week' })
  res.json(reportPayload(report))
}))

/**
 * Create a week's report. `copyFrom` picks the source: a report id, 'blank'
 * for an empty report, or omitted for the latest report before that week.
 */
router.post('/status-reports', wrap(async (req, res) => {
  const week = mondayOf(req.body?.week)
  const existing = db.prepare('SELECT * FROM status_reports WHERE week = ?').get(week)
  if (existing) return res.status(409).json({ error: `A report for the week of ${week} already exists` })

  const info = db.prepare('INSERT INTO status_reports (week, created_at) VALUES (?, ?)').run(week, Date.now())
  const copyFrom = req.body?.copyFrom
  const source =
    copyFrom === 'blank'
      ? null
      : copyFrom
        ? db.prepare('SELECT * FROM status_reports WHERE id = ?').get(Number(copyFrom))
        : db.prepare('SELECT * FROM status_reports WHERE week < ? ORDER BY week DESC LIMIT 1').get(week)
  if (source) {
    // Carry team, epic link, rag + target date; the week's narrative starts blank.
    const rows = db
      .prepare(
        `SELECT e.* FROM report_entries e JOIN initiatives i ON i.id = e.initiative_id
         WHERE e.report_id = ? AND i.archived = 0 AND e.rag != 'done' ORDER BY e.sort_order`
      )
      .all(source.id)
    const insert = db.prepare(
      `INSERT INTO report_entries (report_id, team_id, initiative_id, jira_key, rag, update_text, target_date, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    rows.forEach((e, i) =>
      insert.run(info.lastInsertRowid, e.team_id, e.initiative_id, e.jira_key, e.rag, '', e.target_date, i)
    )
  }
  res.json(reportPayload(db.prepare('SELECT * FROM status_reports WHERE id = ?').get(info.lastInsertRowid)))
}))

/**
 * Import a report exported from another instance. Creates the week if it is
 * missing; otherwise merges: unknown teams and workstreams are created,
 * matching entries (same week, team, workstream) merge their content.
 */
router.post('/status-reports/import', wrap(async (req, res) => {
  const body = req.body || {}
  const week = mondayOf(body.week)
  const entries = Array.isArray(body.entries) ? body.entries : []
  if (!entries.length) return res.status(400).json({ error: 'Nothing to import' })

  db.transaction(() => {
    let report = db.prepare('SELECT * FROM status_reports WHERE week = ?').get(week)
    if (!report) {
      const info = db.prepare('INSERT INTO status_reports (week, created_at) VALUES (?, ?)').run(week, Date.now())
      report = db.prepare('SELECT * FROM status_reports WHERE id = ?').get(info.lastInsertRowid)
    }

    const teamIdByName = () =>
      new Map(db.prepare('SELECT id, name FROM teams').all().map((t) => [t.name.trim().toLowerCase(), t.id]))
    let teams = teamIdByName()

    const findInitiative = (title, jiraKey) => {
      if (jiraKey) {
        const byKey = db.prepare('SELECT * FROM initiatives WHERE jira_key = ?').get(jiraKey)
        if (byKey) return byKey
      }
      return db.prepare('SELECT * FROM initiatives WHERE LOWER(title) = LOWER(?)').get(title)
    }

    let sort = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM report_entries WHERE report_id = ?')
      .get(report.id).m

    for (const raw of entries) {
      const title = String(raw.workstream?.title || raw.title || '').trim()
      if (!title) continue
      const wsKey = String(raw.workstream?.jiraKey || '').trim() || null
      const teamName = String(raw.team || '').trim()

      let teamId = null
      if (teamName) {
        teamId = teams.get(teamName.toLowerCase()) ?? null
        if (teamId == null) {
          const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM teams').get().m
          const info = db.prepare('INSERT INTO teams (name, sort_order) VALUES (?, ?)').run(teamName, max + 1)
          teamId = Number(info.lastInsertRowid)
          teams = teamIdByName()
        }
      }

      let ini = findInitiative(title, wsKey)
      if (!ini) {
        const info = db
          .prepare('INSERT INTO initiatives (title, jira_key, created_at) VALUES (?, ?, ?)')
          .run(title, wsKey, Date.now())
        ini = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(info.lastInsertRowid)
      }

      const incoming = {
        update_text: String(raw.updateText || ''),
        rag: String(raw.rag || 'on-track'),
        target_date: String(raw.targetDate || '') || null,
        jira_key: String(raw.epicKey || '').trim() || null,
      }
      const existing = db
        .prepare('SELECT * FROM report_entries WHERE report_id = ? AND team_id IS ? AND initiative_id = ?')
        .get(report.id, teamId, ini.id)
      if (existing) {
        const m = mergedEntryValues(existing, incoming)
        applyEntryValues.run(m.updateText, m.rag, m.targetDate, m.jiraKey, existing.id)
      } else {
        sort += 1
        db.prepare(
          `INSERT INTO report_entries (report_id, team_id, initiative_id, jira_key, rag, update_text, target_date, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(report.id, teamId, ini.id, incoming.jira_key, incoming.rag, incoming.update_text, incoming.target_date, sort)
      }
    }
  })()

  const report = db.prepare('SELECT * FROM status_reports WHERE week = ?').get(week)
  res.json(reportPayload(report))
}))

router.delete('/status-reports/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM report_entries WHERE report_id = ?').run(req.params.id)
  db.prepare('DELETE FROM status_reports WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
}))

router.post('/status-reports/:id/entries', wrap(async (req, res) => {
  const report = db.prepare('SELECT * FROM status_reports WHERE id = ?').get(req.params.id)
  if (!report) return res.status(404).json({ error: 'No such report' })
  const initiativeId = Number(req.body?.initiativeId)
  if (!db.prepare('SELECT id FROM initiatives WHERE id = ?').get(initiativeId)) {
    return res.status(400).json({ error: 'No such initiative' })
  }
  const teamId = req.body?.teamId != null ? Number(req.body.teamId) : null
  const jiraKey = String(req.body?.jiraKey || '').trim() || null
  const max = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM report_entries WHERE report_id = ?')
    .get(report.id).m
  db.prepare(
    'INSERT OR IGNORE INTO report_entries (report_id, team_id, initiative_id, jira_key, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(report.id, teamId, initiativeId, jiraKey, max + 1)
  res.json(reportPayload(report))
}))

/** Persist the workstream order for a week: sort_order = index of the group. */
router.put('/status-reports/:id/order', wrap(async (req, res) => {
  const ids = req.body?.initiativeIds
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'initiativeIds must be an array' })
  const stmt = db.prepare('UPDATE report_entries SET sort_order = ? WHERE report_id = ? AND initiative_id = ?')
  db.transaction(() => {
    ids.forEach((iid, idx) => stmt.run(idx, req.params.id, Number(iid)))
  })()
  res.json({ ok: true })
}))

router.put('/status-entries/:id', wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM report_entries WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'No such entry' })
  const rag = req.body?.rag !== undefined ? String(req.body.rag) : row.rag
  const updateText = req.body?.updateText !== undefined ? String(req.body.updateText) : row.update_text
  const targetDate =
    req.body?.targetDate !== undefined ? String(req.body.targetDate || '') || null : row.target_date
  const jiraKey =
    req.body?.jiraKey !== undefined ? String(req.body.jiraKey || '').trim() || null : row.jira_key
  db.prepare('UPDATE report_entries SET rag = ?, update_text = ?, target_date = ?, jira_key = ? WHERE id = ?')
    .run(rag, updateText, targetDate, jiraKey, row.id)
  res.json({ ok: true })
}))

router.delete('/status-entries/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM report_entries WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
}))

/** Site base URL so the UI can deep-link an issue key back into Jira. */
router.get('/site-url', wrap(async (req, res) => {
  const cloudId = activeCloudId()
  const row = cloudId ? db.prepare('SELECT url FROM sites WHERE cloud_id = ?').get(cloudId) : null
  res.json({ url: row?.url || null })
}))
