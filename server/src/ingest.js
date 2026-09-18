import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { SCHEMA_FILE } from './config.js'
import { db } from './db.js'

/* ────────────────────────────────────────────────────── validation

   A manifest is either schema-valid and accepted, or quarantined whole. There
   is no partial import, ever — a half-imported manifest is indistinguishable
   from a real finding, which is the one failure mode this whole design exists
   to prevent.
*/

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

let validator = null
function validate() {
  if (!validator) {
    validator = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')))
  }
  return validator
}

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
 * Idempotent per repo: re-ingesting a repo replaces exactly that repo's
 * contribution and touches nothing else. Overrides are a separate table and
 * are never read or written here — that is what makes a human correction
 * survive the next scan.
 */
export function ingestManifest(json, sourceFile = null) {
  const { ok, errors } = validateManifest(json)
  const now = new Date().toISOString()
  const repo = json?.repo ?? sourceFile ?? 'unknown'

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
  runLinkPass(now)
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

/* Phases 2 and 4 replace these; ingest already calls them so the wiring is
   in place and an ingest is one operation from the caller's side. */

function runLinkPass(now) {
  void now
}

function rebuildSearch() {}

/* ────────────────────────────────────────────────────── inbox */

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
      results.push({ file, ok: false, errors: [{ path: '/', message: `Not valid JSON: ${err.message}` }] })
      fs.renameSync(full, path.join(dir, 'quarantine', file))
      continue
    }

    const result = ingestManifest(parsed, file)
    results.push({ file, ...result })
    fs.renameSync(full, path.join(dir, result.ok ? 'ingested' : 'quarantine', file))
  }
  return results
}
