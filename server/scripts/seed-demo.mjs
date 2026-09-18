#!/usr/bin/env node
/**
 * Generates the Meridian demo estate (SPEC.md §12) as ten manifests in
 * demo/manifests/, then ingests them through the real ingest path.
 *
 *   npm run seed:demo
 *   npm run seed:demo -- --remove     clear it out of the database again
 *   npm run seed:demo -- --remove --files   …and delete the generated files
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
import { ingestProcessPack, rebuildProcesses, validateProcessPack } from '../src/processes.js'
import { linkPass } from '../src/link.js'
import { buildManifests } from './demo/manifests.mjs'
import { SERVICES } from './demo/estate.mjs'
import { PACK_IDS, buildPacks } from './demo/packs.mjs'

const DIR = path.join(ROOT, 'demo', 'manifests')
const PACK_DIR = path.join(ROOT, 'demo', 'processes')
const REPOS = SERVICES.map((s) => s.repo)
const args = process.argv.slice(2)

if (args.includes('--remove')) {
  remove({ files: args.includes('--files') })
} else {
  seed({ writeOnly: args.includes('--write-only') })
}

function seed({ writeOnly }) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.mkdirSync(PACK_DIR, { recursive: true })
  const manifests = buildManifests()
  const packs = buildPacks()

  let invalid = 0
  const write = (dir, name, body, check, label) => {
    const { ok, errors } = check(body)
    if (!ok) {
      invalid++
      console.error(`✗ ${label} is not schema-valid:`)
      for (const e of errors) console.error(`    ${e.path} ${e.message}`)
    }
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`)
  }

  for (const m of manifests) write(DIR, m.repo, m, validateManifest, m.repo)
  for (const p of packs) write(PACK_DIR, p.pack, p, validateProcessPack, p.pack)

  if (invalid) {
    console.error(`\n${invalid} file(s) failed validation — not ingesting.`)
    process.exit(1)
  }
  console.log(
    `Wrote ${manifests.length} manifests to demo/manifests/ and ${packs.length} process packs to demo/processes/`
  )
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

  // Packs after the manifests, because a pack resolves against topology — and
  // the link pass re-resolves after every ingest, so the order is a courtesy
  // rather than a requirement.
  for (const pack of PACK_IDS) {
    const file = `${pack}.json`
    const json = JSON.parse(fs.readFileSync(path.join(PACK_DIR, file), 'utf8'))
    const result = ingestProcessPack(json, file)
    if (!result.ok) {
      console.error(`✗ ${pack} was quarantined:`, result.errors)
      process.exit(1)
    }
    const c = result.counts
    console.log(
      `  ✓ ${pack.padEnd(21)} ${String(c.processes).padStart(2)} processes  ` +
        `${c.level1}/${c.level2}/${c.level3} by level`
    )
  }

  summarise()
}

/**
 * Clears the demo estate out of the database. The generated files under
 * `demo/` are committed fixtures — `npm run verify` ends with this, and a
 * verification run that silently deletes thirteen tracked files is a worse
 * bug than anything it could find. Deleting them is opt-in: `--files`.
 */
function remove({ files = false } = {}) {
  const marks = REPOS.map(() => '?').join(',')
  const packMarks = PACK_IDS.map(() => '?').join(',')
  db.transaction(() => {
    // Derived rows cascade off the manifest and the pack; nodes are
    // reference-counted, and the join tables are rebuilt by the link pass.
    db.prepare(`DELETE FROM manifests WHERE repo IN (${marks})`).run(...REPOS)
    db.prepare(`DELETE FROM process_packs WHERE pack IN (${packMarks})`).run(...PACK_IDS)
    // The demo pack's row may have been holding a code somebody else's pack
    // also declares — the cascade would take that away and nothing would bring
    // it back. `processes` is a function of the active packs, so rebuild it.
    rebuildProcesses()
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
  if (files) {
    for (const [dir, names] of [
      [DIR, REPOS],
      [PACK_DIR, PACK_IDS],
    ]) {
      if (!fs.existsSync(dir)) continue
      for (const name of names) {
        const file = path.join(dir, `${name}.json`)
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
          removed++
        }
      }
    }
  }
  console.log(
    `Cleared the demo estate from the database: ${REPOS.length} repos and ${PACK_IDS.length} process packs.` +
      (files
        ? ` Deleted ${removed} generated file(s) under demo/.`
        : ' The files under demo/ are left alone — pass --files to delete them too.')
  )
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
  const levels = [1, 2, 3].map((l) => n(`SELECT COUNT(*) n FROM processes WHERE level = ${l}`))
  console.log(
    `  packs ${n(`SELECT COUNT(*) n FROM process_packs WHERE status = 'active'`)} · ` +
      `processes ${n('SELECT COUNT(*) n FROM processes')} (${levels.join('/')} by level) · ` +
      `component links ${n('SELECT COUNT(*) n FROM process_components')}`
  )
  const drift = db.prepare('SELECT kind, COUNT(*) AS n FROM drift GROUP BY kind ORDER BY kind').all()
  console.log(`  drift ${drift.length ? drift.map((d) => `${d.kind} ${d.n}`).join(' · ') : 'none'}\n`)
}
