import fs from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { SCHEMA_FILE } from './config.js'
import { db } from './db.js'

/* ────────────────────────────────────────────────────── validation

   This half is complete: a manifest is either schema-valid and accepted, or
   quarantined whole. There is no partial import, ever — a half-imported
   manifest is indistinguishable from a real finding, which is the one failure
   mode this whole design exists to prevent.

   The upsert half (writing nodes, edges, evidence, bindings) is SPEC.md
   Phase 1, and is not written yet. See the TODO below.
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

/* ────────────────────────────────────────────────────── ingest */

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

  // TODO (SPEC.md Phase 1): supersede this repo's previous manifests, delete
  // their derived rows, then upsert service/nodes/edges/evidence/unresolved and
  // contract_bindings inside one transaction. Then run the link pass and
  // rebuild the search index for the affected subjects.
  //
  // Until that lands, a valid manifest is recorded but contributes no topology.
  const info = db
    .prepare(
      `INSERT INTO manifests
         (repo, commit_sha, branch, scanned_at, ingested_at, schema_version, prompt_version,
          producer_kind, producer_detail, service_id, source_file, status, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(
      json.repo,
      json.commit ?? null,
      json.branch ?? null,
      json.scannedAt ?? null,
      now,
      json.schemaVersion,
      json.promptVersion ?? null,
      json.producer?.kind ?? null,
      json.producer?.model ?? json.producer?.tool ?? json.producer?.author ?? null,
      json.service?.id ?? null,
      sourceFile,
      JSON.stringify(json)
    )

  return {
    ok: true,
    repo: json.repo,
    manifestId: info.lastInsertRowid,
    counts: {
      nodes: json.nodes?.length ?? 0,
      edges: json.edges?.length ?? 0,
      unresolved: json.unresolved?.length ?? 0,
    },
    note: 'Manifest validated and recorded. Topology upsert lands in Phase 1.',
  }
}

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
