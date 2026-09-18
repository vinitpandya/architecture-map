#!/usr/bin/env node
/**
 * Validate a file against the schema its shape calls for, without touching the
 * database. This is what you run before dropping a file in the inbox — a fast,
 * local "would this be accepted?".
 *
 *   npm run validate -- inbox/payments-service.json
 *   npm run validate -- demo/processes/onboarding.json
 *
 * It routes exactly as the inbox sweep does: a `repo` property means a scan
 * manifest, a `pack` property means a process pack, and neither means the file
 * is not something this app ingests. Exits 0 when every file is valid.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const files = process.argv.slice(2)

if (!files.length) {
  console.error('usage: npm run validate -- <manifest.json> [...]')
  process.exit(2)
}

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

const schema = (name) =>
  ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', name), 'utf8')))

const VALIDATORS = {
  manifest: { label: 'scan manifest', validate: schema('manifest.schema.json') },
  'process-pack': { label: 'process pack', validate: schema('process-pack.schema.json') },
}

/** Same rule as the inbox sweep: shape decides, not the filename. */
const kindOf = (data) =>
  data && typeof data === 'object'
    ? 'repo' in data
      ? 'manifest'
      : 'pack' in data
        ? 'process-pack'
        : null
    : null

const summarise = {
  manifest: (d) => {
    const n = (k) => d[k]?.length ?? 0
    return `${d.repo} @ ${d.commit ?? '?'} — ${n('nodes')} nodes, ${n('edges')} edges, ${n('unresolved')} unresolved`
  },
  'process-pack': (d) => {
    const levels = [1, 2, 3].map(
      (l) => (d.processes ?? []).filter((p) => String(p.code).replace(/^[Ll]/, '').split('.').length === l).length
    )
    const leaves = (d.processes ?? []).filter(
      (p) =>
        !(d.processes ?? []).some((q) =>
          String(q.code).replace(/^[Ll]/, '').startsWith(`${String(p.code).replace(/^[Ll]/, '')}.`)
        )
    ).length
    return `${d.pack} — ${d.processes?.length ?? 0} processes (${levels.join('/')} by level), ${leaves} leaves`
  },
}

let failed = 0

for (const file of files) {
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`✗ ${file}\n    not valid JSON: ${err.message}`)
    failed++
    continue
  }

  const kind = kindOf(data)
  if (!kind) {
    console.error(`✗ ${file}\n    not a scan manifest (no \`repo\`) or a process pack (no \`pack\`)`)
    failed++
    continue
  }

  const { label, validate } = VALIDATORS[kind]

  if (validate(data)) {
    console.log(`✓ ${file}  valid ${label} — ${summarise[kind](data)}`)
    continue
  }

  failed++
  console.error(`✗ ${file}  invalid ${label}`)
  for (const e of validate.errors) {
    const where = e.instancePath || '/'
    const extra = e.params?.allowedValues ? ` (allowed: ${e.params.allowedValues.join(', ')})` : ''
    console.error(`    ${where} ${e.message}${extra}`)
  }
}

process.exit(failed ? 1 : 0)
