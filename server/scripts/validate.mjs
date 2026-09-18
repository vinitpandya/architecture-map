#!/usr/bin/env node
/**
 * Validate a manifest against schema/manifest.schema.json without touching the
 * database. This is what you run before dropping a file in the inbox — a fast,
 * local "would this be accepted?".
 *
 *   npm run validate -- inbox/payments-service.json
 *
 * Exits 0 when every file is valid, 1 otherwise.
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
const validate = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'manifest.schema.json'), 'utf8'))
)

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

  if (validate(data)) {
    const n = (k) => data[k]?.length ?? 0
    console.log(
      `✓ ${file}  ${data.repo} @ ${data.commit ?? '?'} — ` +
        `${n('nodes')} nodes, ${n('edges')} edges, ${n('unresolved')} unresolved`
    )
    continue
  }

  failed++
  console.error(`✗ ${file}`)
  for (const e of validate.errors) {
    const where = e.instancePath || '/'
    const extra = e.params?.allowedValues ? ` (allowed: ${e.params.allowedValues.join(', ')})` : ''
    console.error(`    ${where} ${e.message}${extra}`)
  }
}

process.exit(failed ? 1 : 0)
