#!/usr/bin/env node
/**
 * Generates the Meridian demo estate (SPEC.md §12) as ten manifests in
 * demo/manifests/, then ingests them through the real ingest path.
 *
 *   npm run seed:demo
 *   npm run seed:demo -- --remove     clear it again
 *   npm run seed:demo -- --write-only just rewrite the manifests
 *
 * The real service repositories are not available to this build, so this
 * estate is how ingest, the link pass, drift and the map get verified end to
 * end. The numbers in SPEC.md §14 are derived from §12, so changing the estate
 * changes the test suite.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../src/config.js'
import { db } from '../src/db.js'
import { ingestManifest, rebuildSearch, validateManifest } from '../src/ingest.js'
import { linkPass } from '../src/link.js'
import { buildManifests } from './demo/manifests.mjs'
import { SERVICES } from './demo/estate.mjs'

const DIR = path.join(ROOT, 'demo', 'manifests')
const REPOS = SERVICES.map((s) => s.repo)
const args = process.argv.slice(2)

if (args.includes('--remove')) {
  remove()
} else {
  seed({ writeOnly: args.includes('--write-only') })
}

function seed({ writeOnly }) {
  fs.mkdirSync(DIR, { recursive: true })
  const manifests = buildManifests()

  let invalid = 0
  for (const m of manifests) {
    const { ok, errors } = validateManifest(m)
    if (!ok) {
      invalid++
      console.error(`✗ ${m.repo} is not schema-valid:`)
      for (const e of errors) console.error(`    ${e.path} ${e.message}`)
    }
    fs.writeFileSync(path.join(DIR, `${m.repo}.json`), `${JSON.stringify(m, null, 2)}\n`)
  }
  if (invalid) {
    console.error(`\n${invalid} manifest(s) failed validation — not ingesting.`)
    process.exit(1)
  }
  console.log(`Wrote ${manifests.length} manifests to demo/manifests/`)
  if (writeOnly) return

  // Read them back off disk and ingest those: what is committed is exactly
  // what the app is verified against, with no in-memory shortcut.
  for (const repo of REPOS) {
    const file = `${repo}.json`
    const json = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
    const result = ingestManifest(json, file)
    if (!result.ok) {
      console.error(`✗ ${repo} was quarantined:`, result.errors)
      process.exit(1)
    }
    console.log(
      `  ✓ ${repo.padEnd(21)} ${String(result.counts.nodes).padStart(2)} nodes  ` +
        `${String(result.counts.edges).padStart(2)} edges  ${result.counts.unresolved} unresolved`
    )
  }

  summarise()
}

function remove() {
  const marks = REPOS.map(() => '?').join(',')
  db.transaction(() => {
    // Derived rows cascade off the manifest; nodes are reference-counted.
    db.prepare(`DELETE FROM manifests WHERE repo IN (${marks})`).run(...REPOS)
    db.prepare(
      `DELETE FROM nodes
       WHERE id NOT IN (SELECT node_id FROM node_sources)
         AND id NOT IN (SELECT from_id FROM edges)
         AND id NOT IN (SELECT to_id FROM edges)`
    ).run()
  })()
  linkPass()
  rebuildSearch()

  let removed = 0
  if (fs.existsSync(DIR)) {
    for (const repo of REPOS) {
      const file = path.join(DIR, `${repo}.json`)
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        removed++
      }
    }
  }
  console.log(`Removed the demo estate: ${removed} manifest files, ${REPOS.length} repos cleared from the database.`)
  summarise()
}

function summarise() {
  const byKind = Object.fromEntries(
    db.prepare('SELECT kind, COUNT(*) AS n FROM nodes GROUP BY kind').all().map((r) => [r.kind, r.n])
  )
  const n = (sql) => db.prepare(sql).get().n
  console.log(
    `\n  services ${byKind['service'] ?? 0} · topics ${byKind['kafka.topic'] ?? 0} · ` +
      `databases ${byKind['database'] ?? 0} · caches ${byKind['cache'] ?? 0} · ` +
      `contracts ${byKind['contract'] ?? 0} · endpoints ${byKind['endpoint'] ?? 0} · ` +
      `externals ${byKind['external'] ?? 0}`
  )
  console.log(
    `  edges ${n('SELECT COUNT(*) n FROM edges')} · evidence ${n('SELECT COUNT(*) n FROM evidence')} · ` +
      `unresolved ${n('SELECT COUNT(*) n FROM unresolved')} · orphans ${n('SELECT COUNT(*) n FROM nodes WHERE orphan = 1')} · ` +
      `quarantined ${n(`SELECT COUNT(*) n FROM manifests WHERE status = 'quarantined'`)}`
  )
  const drift = db.prepare('SELECT kind, COUNT(*) AS n FROM drift GROUP BY kind ORDER BY kind').all()
  console.log(`  drift ${drift.length ? drift.map((d) => `${d.kind} ${d.n}`).join(' · ') : 'none'}\n`)
}
