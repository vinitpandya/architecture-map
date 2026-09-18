import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { SCHEMA_FILE } from './config.js'
import { db } from './db.js'
import { linkPass } from './link.js'
// Cyclic with processes.js, which imports this module for edgeId() and the
// shared ajv. Safe because every reference on both sides is inside a function
// body, so nothing is touched until both modules have finished evaluating.
import { ingestProcessPack } from './processes.js'

/* ────────────────────────────────────────────────────── validation

   A manifest is either schema-valid and accepted, or quarantined whole. There
   is no partial import, ever — a half-imported manifest is indistinguishable
   from a real finding, which is the one failure mode this whole design exists
   to prevent.
*/

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

const compiled = new Map()

/**
 * One ajv, one configuration, for every schema in the project. Layer B
 * validates through this too, so a pack and a manifest are held to the same
 * standard of error reporting.
 */
export function compileSchema(file) {
  if (!compiled.has(file)) {
    compiled.set(file, ajv.compile(JSON.parse(fs.readFileSync(file, 'utf8'))))
  }
  return compiled.get(file)
}

const validate = () => compileSchema(SCHEMA_FILE)

/** Readable one-liners from ajv's output, for the UI and the CLI. */
export function explainErrors(errors) {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message,
    params: e.params,
  }))
}

export function validateManifest(json) {
  const check = validate()
  return check(json) ? { ok: true, errors: null } : { ok: false, errors: explainErrors(check.errors) }
}

/* ────────────────────────────────────────────────────── identity

   An edge's key is derived from the triple alone, so re-ingesting the same
   manifest with its evidence in a different order produces the same id. That
   matters because overrides and process steps point at these ids.
*/

export const edgeId = (from, kind, to) =>
  crypto.createHash('sha1').update(`${from}|${kind}|${to}`).digest('hex')

/* ────────────────────────────────────────────────────── statements

   Prepared once. `@repo` is the repo currently being ingested, which the
   conflict clauses need in order to tell "the repo that owns this node is
   correcting itself" from "another repo is mentioning it in passing".
*/

/**
 * Descriptive columns: the owning repo's value wins. A repo that merely
 * references someone else's node can fill a gap but never overwrite a claim.
 */
const claimed = (col) => `
  ${col} = CASE
    WHEN nodes.owner_repo IS NOT NULL AND nodes.owner_repo <> @repo
      THEN COALESCE(nodes.${col}, excluded.${col})
    ELSE COALESCE(excluded.${col}, nodes.${col})
  END`

const UPSERT_NODE = `
INSERT INTO nodes (id, kind, name, description, engine, method, path, contract_type,
                   language, team, owner_repo, orphan, first_seen, last_seen)
VALUES (@id, @kind, @name, @description, @engine, @method, @path, @contract_type,
        @language, @team, @owner_repo, 0, @now, @now)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  name = CASE
    WHEN nodes.owner_repo IS NOT NULL AND nodes.owner_repo <> @repo THEN nodes.name
    ELSE excluded.name
  END,
  ${claimed('description')},
  ${claimed('engine')},
  ${claimed('method')},
  ${claimed('path')},
  ${claimed('contract_type')},
  ${claimed('language')},
  ${claimed('team')},
  owner_repo = COALESCE(excluded.owner_repo, nodes.owner_repo),
  orphan     = 0,
  last_seen  = excluded.last_seen`  /* first_seen is never rewritten */

const UPSERT_EDGE = `
INSERT INTO edges (id, from_id, to_id, kind, contract_id, description, confidence,
                   repo, manifest_id, first_seen, last_seen)
VALUES (@id, @from_id, @to_id, @kind, @contract_id, @description, @confidence,
        @repo, @manifest_id, @first_seen, @now)
ON CONFLICT(id) DO UPDATE SET
  contract_id = COALESCE(excluded.contract_id, edges.contract_id),
  description = COALESCE(excluded.description, edges.description),
  confidence  = excluded.confidence,
  repo        = excluded.repo,
  manifest_id = excluded.manifest_id,
  last_seen   = excluded.last_seen`

const DERIVED_TABLES = ['node_sources', 'edges', 'evidence', 'unresolved', 'contract_bindings']

/* ────────────────────────────────────────────────────── ingest */

/**
 * The name a quarantined document is filed under, taken off a body that has
 * just failed validation and could hold anything. A number, an object or a
 * null in `repo` would otherwise reach SQLite as a bind parameter it refuses,
 * and the throw would take the whole inbox sweep down with it — one malformed
 * file stopping every good one behind it.
 */
export function labelOf(value, fallback) {
  const s = typeof value === 'string' ? value.trim() : ''
  return s || fallback || 'unknown'
}

/**
 * Idempotent per repo: re-ingesting a repo replaces exactly that repo's
 * contribution and touches nothing else. Overrides are a separate table and
 * are never read or written here — that is what makes a human correction
 * survive the next scan.
 */
export function ingestManifest(json, sourceFile = null) {
  const { ok, errors } = validateManifest(json)
  const now = new Date().toISOString()
  const repo = labelOf(json?.repo, sourceFile)

  if (!ok) {
    db.prepare(
      `INSERT INTO manifests (repo, ingested_at, status, raw, errors, source_file)
       VALUES (?, ?, 'quarantined', ?, ?, ?)`
    ).run(repo, now, JSON.stringify(json ?? null), JSON.stringify(errors), sourceFile)
    return { ok: false, repo, errors }
  }

  const result = upsertTopology(json, sourceFile, now)

  // The link pass is global and cheap, and ownership and drift are only
  // correct across the whole estate, so it runs after every single ingest.
  linkPass(now)
  rebuildSearch()

  return result
}

const upsertTopology = db.transaction((json, sourceFile, now) => {
  const repo = json.repo
  const service = json.service
  const prior = db
    .prepare(`SELECT id FROM manifests WHERE repo = ? AND status = 'active'`)
    .all(repo)
    .map((r) => r.id)

  // An edge keeps its first_seen across re-ingests even though the row itself
  // is deleted and rebuilt, so "since when has this call existed" stays true.
  const wasSeen = new Map()
  if (prior.length) {
    const marks = prior.map(() => '?').join(',')
    for (const r of db.prepare(`SELECT id, first_seen FROM edges WHERE manifest_id IN (${marks})`).all(...prior)) {
      wasSeen.set(r.id, r.first_seen)
    }
    db.prepare(`UPDATE manifests SET status = 'superseded' WHERE id IN (${marks})`).run(...prior)
    for (const table of DERIVED_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE manifest_id IN (${marks})`).run(...prior)
    }
  }

  const manifestId = db
    .prepare(
      `INSERT INTO manifests
         (repo, commit_sha, branch, scanned_at, ingested_at, schema_version, prompt_version,
          producer_kind, producer_detail, service_id, source_file, status, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(
      repo,
      json.commit ?? null,
      json.branch ?? null,
      json.scannedAt ?? null,
      now,
      json.schemaVersion,
      json.promptVersion ?? null,
      json.producer?.kind ?? null,
      json.producer?.model ?? json.producer?.tool ?? json.producer?.author ?? null,
      service.id,
      sourceFile,
      JSON.stringify(json)
    ).lastInsertRowid

  const upsertNode = db.prepare(UPSERT_NODE)
  const upsertEdge = db.prepare(UPSERT_EDGE)
  const addSource = db.prepare(
    `INSERT INTO node_sources (node_id, manifest_id, repo) VALUES (?, ?, ?)
     ON CONFLICT(node_id, manifest_id) DO NOTHING`
  )
  const addEvidence = db.prepare(
    `INSERT INTO evidence (subject_kind, subject_id, repo, file, line, end_line, snippet, manifest_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const addUnresolved = db.prepare(
    `INSERT INTO unresolved (repo, expected, raw, reason, manifest_id) VALUES (?, ?, ?, ?, ?)`
  )
  const bindContract = db.prepare(
    `INSERT INTO contract_bindings (contract_id, service_id, version, manifest_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(contract_id, service_id) DO UPDATE SET
       version = excluded.version, manifest_id = excluded.manifest_id`
  )

  const blank = {
    description: null, engine: null, method: null, path: null,
    contract_type: null, language: null, team: null, owner_repo: null,
  }
  const evidenceFor = (kind, id, list) => {
    for (const ev of list ?? []) {
      addEvidence.run(kind, id, repo, ev.file, ev.line, ev.endLine ?? null, ev.snippet, manifestId)
    }
  }

  // The service this repo builds. Only its own manifest can claim it, which is
  // what owner_repo records.
  upsertNode.run({
    ...blank,
    id: service.id,
    kind: 'service',
    name: service.name,
    description: service.description ?? null,
    language: service.language ?? null,
    team: service.team ?? null,
    owner_repo: repo,
    repo,
    now,
  })
  addSource.run(service.id, manifestId, repo)

  for (const n of json.nodes ?? []) {
    upsertNode.run({
      ...blank,
      id: n.id,
      kind: n.kind,
      name: n.name,
      description: n.description ?? null,
      engine: n.engine ?? null,
      method: n.method ?? null,
      path: n.path ?? null,
      contract_type: n.contractType ?? null,
      repo,
      now,
    })
    addSource.run(n.id, manifestId, repo)
    evidenceFor('node', n.id, n.evidence)

    // A version belongs to the service that binds it, never to the contract
    // node — putting it on the node is what would destroy skew detection.
    if (n.kind === 'contract' && n.version) {
      bindContract.run(n.id, service.id, n.version, manifestId)
    }
  }

  for (const e of json.edges ?? []) {
    const id = edgeId(e.from, e.kind, e.to)
    const firstSeen =
      wasSeen.get(id) ??
      db.prepare('SELECT first_seen FROM edges WHERE id = ?').get(id)?.first_seen ??
      now
    upsertEdge.run({
      id,
      from_id: e.from,
      to_id: e.to,
      kind: e.kind,
      contract_id: e.contract ?? null,
      description: e.description ?? null,
      confidence: e.confidence,
      repo,
      manifest_id: manifestId,
      first_seen: firstSeen,
      now,
    })
    evidenceFor('edge', id, e.evidence)
  }

  for (const u of json.unresolved ?? []) {
    const id = addUnresolved.run(repo, u.expected, u.raw, u.reason ?? null, manifestId).lastInsertRowid
    evidenceFor('unresolved', String(id), u.evidence)
  }

  // Anything this repo used to assert and no longer does, that nothing else
  // asserts or points at, stops existing.
  db.prepare(
    `DELETE FROM nodes
     WHERE id NOT IN (SELECT node_id FROM node_sources)
       AND id NOT IN (SELECT from_id FROM edges)
       AND id NOT IN (SELECT to_id FROM edges)`
  ).run()

  return {
    ok: true,
    repo,
    manifestId,
    counts: {
      nodes: (json.nodes?.length ?? 0) + 1,
      edges: json.edges?.length ?? 0,
      unresolved: json.unresolved?.length ?? 0,
    },
  }
})

/* ────────────────────────────────────────────────────────────── search

   FTS5, rebuilt wholesale after each ingest. At estate scale that is a few
   hundred rows and cheaper than working out which subjects an ingest touched
   — a repo's manifest can change another repo's node through ownership, so
   "affected" is wider than it looks.

   The evidence snippets are the point. Searching `@KafkaListener` or a table
   name has to find the code; an index of names alone throws away most of the
   value of having collected the evidence at all. */

export function rebuildSearch() {
  const evidence = new Map()
  for (const e of db.prepare('SELECT subject_kind, subject_id, file, snippet FROM evidence').all()) {
    const key = `${e.subject_kind}|${e.subject_id}`
    if (!evidence.has(key)) evidence.set(key, [])
    evidence.get(key).push(`${e.file} ${e.snippet}`)
  }
  const cited = (kind, id) => evidence.get(`${kind}|${id}`) ?? []

  const nodes = db.prepare('SELECT * FROM nodes').all()
  const named = new Map(nodes.map((n) => [n.id, n.name]))
  const label = (id) => named.get(id) ?? id.slice(id.indexOf(':') + 1)

  const write = db.transaction(() => {
    db.prepare('DELETE FROM search_index').run()
    const add = db.prepare(
      'INSERT INTO search_index (subject_kind, subject_id, title, body, repo) VALUES (?, ?, ?, ?, ?)'
    )

    for (const n of nodes) {
      const body = [
        n.id,
        n.description,
        n.kind,
        n.engine,
        n.method,
        n.path,
        n.contract_type,
        n.language,
        n.team,
        n.owner_repo,
        ...cited('node', n.id),
      ]
      add.run('node', n.id, n.name, body.filter(Boolean).join('\n'), n.owner_repo ?? '')
    }

    for (const e of db.prepare('SELECT * FROM edges').all()) {
      const snippets = cited('edge', e.id)
      if (!e.description && !snippets.length) continue
      const body = [e.kind, e.description, e.from_id, e.to_id, e.contract_id, e.repo, ...snippets]
      add.run('edge', e.id, `${label(e.from_id)} → ${label(e.to_id)}`, body.filter(Boolean).join('\n'), e.repo)
    }

    for (const u of db.prepare('SELECT * FROM unresolved').all()) {
      const body = [u.expected, u.reason, u.repo, ...cited('unresolved', String(u.id))]
      add.run('unresolved', String(u.id), u.raw, body.filter(Boolean).join('\n'), u.repo)
    }

    // Layer B. The code goes in twice, with and without its prefix, because
    // people type both — and every component the process touches goes in with
    // it, so searching a service id finds the processes that run through it.
    const componentsOf = new Map()
    for (const r of db.prepare('SELECT process_id, node_id FROM process_components').all()) {
      if (!componentsOf.has(r.process_id)) componentsOf.set(r.process_id, [])
      componentsOf.get(r.process_id).push(r.node_id)
    }
    for (const p of db.prepare('SELECT * FROM processes').all()) {
      const components = componentsOf.get(p.id) ?? []
      const body = [
        p.code,
        `L${p.code}`,
        p.name,
        p.description,
        p.trigger,
        p.outcome,
        p.owner,
        p.actor,
        p.notes,
        ...(parseList(p.tags)),
        p.node_id,
        p.edge_from,
        p.edge_to,
        ...components,
        ...components.map((id) => named.get(id)).filter(Boolean),
      ]
      add.run('process', p.id, `L${p.code} · ${p.name}`, body.filter(Boolean).join('\n'), p.owner ?? '')
    }
  })
  write()
}

const parseList = (json) => {
  try {
    const v = JSON.parse(json ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/* ────────────────────────────────────────────────────── inbox */

/**
 * What a file in the inbox is, by shape rather than by filename or folder —
 * one drop point and nothing to remember.
 */
export function inboxKind(json) {
  if (json && typeof json === 'object') {
    if ('repo' in json) return 'manifest'
    if ('pack' in json) return 'process-pack'
  }
  return null
}

export const NOT_INGESTABLE =
  'not a scan manifest (no `repo`) or a process pack (no `pack`)'

/** Ingest every *.json in the inbox, filing each by outcome. */
export function sweepInbox(dir) {
  const results = []
  if (!fs.existsSync(dir)) return results

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const full = path.join(dir, file)
    let parsed = null
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (err) {
      results.push({ file, kind: null, ok: false, errors: [{ path: '/', message: `Not valid JSON: ${err.message}` }] })
      fs.renameSync(full, path.join(dir, 'quarantine', file))
      continue
    }

    const kind = inboxKind(parsed)
    if (!kind) {
      results.push({ file, kind: null, ok: false, errors: [{ path: '/', message: NOT_INGESTABLE }] })
      fs.renameSync(full, path.join(dir, 'quarantine', file))
      continue
    }

    const result =
      kind === 'process-pack' ? ingestProcessPack(parsed, file) : ingestManifest(parsed, file)
    results.push({ file, kind, ...result })
    fs.renameSync(full, path.join(dir, result.ok ? 'ingested' : 'quarantine', file))
  }
  return results
}
