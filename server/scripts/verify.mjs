#!/usr/bin/env node
/**
 * SPEC.md §14, as a runnable check.
 *
 *   npm run verify
 *
 * Everything here is checkable without the real service repositories — that is
 * what the demo estate is for. It runs against throwaway databases under
 * data/verify/ and never touches the working one, so it is safe at any time.
 *
 * The §14 items it cannot do are the four Phase 5 ones: stable positions across
 * two loads, arrow direction, dark mode and no horizontal scroll at 1280px.
 * Those want a browser and a pair of eyes.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const stage = process.argv.find((a) => a.startsWith('--stage='))?.slice(8)

let failures = 0
let checks = 0

const pass = (name, extra = '') => {
  checks++
  console.log(`  ✓ ${name}${extra ? `  ${extra}` : ''}`)
}
const fail = (name, detail) => {
  checks++
  failures++
  console.log(`  ✗ ${name}\n      ${detail}`)
}
const is = (name, actual, expected) =>
  actual === expected ? pass(name, String(actual)) : fail(name, `expected ${expected}, got ${actual}`)
const ok = (name, condition, detail) => (condition ? pass(name) : fail(name, detail))

/* ────────────────────────────────────────────────────────── orchestration */

if (!stage) {
  const tmp = path.join(ROOT, 'data', 'verify')
  fs.rmSync(tmp, { recursive: true, force: true })
  let bad = 0
  for (const s of ['ingest', 'estate']) {
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--stage=${s}`], {
      stdio: 'inherit',
      env: { ...process.env, DATA_DIR: path.join(tmp, s), INBOX_DIR: path.join(tmp, s, 'inbox') },
    })
    if (res.status !== 0) bad++
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  if (bad) {
    console.log(`\n${bad} stage(s) failed.\n`)
    process.exit(1)
  }
  console.log('\nAll verification stages passed.\n')
  process.exit(0)
}

/* ──────────────────────────────────────────────────── stage: ingest (§14 P1) */

if (stage === 'ingest') {
  console.log('\nPhase 1 — ingest')
  const { ingestManifest, validateManifest } = await import('../src/ingest.js')
  const { db } = await import('../src/db.js')

  const example = path.join(ROOT, 'schema', 'example.payments-service.json')
  const good = JSON.parse(fs.readFileSync(example, 'utf8'))
  const broken = structuredClone(good)
  broken.edges[0].kind = 'kafka.produced'

  const cli = (file) =>
    spawnSync(process.execPath, [path.join(HERE, 'validate.mjs'), file], { encoding: 'utf8' })

  is('validate.mjs exits 0 on the example', cli(example).status, 0)

  const brokenFile = path.join(process.env.DATA_DIR, 'broken.json')
  fs.mkdirSync(path.dirname(brokenFile), { recursive: true })
  fs.writeFileSync(brokenFile, JSON.stringify(broken))
  const run = cli(brokenFile)
  is('validate.mjs exits 1 on a kind typo', run.status, 1)
  ok(
    'the error names the offending path',
    run.stderr.includes('/edges/0/kind'),
    `stderr did not mention /edges/0/kind:\n${run.stderr}`
  )
  ok('validateManifest agrees', validateManifest(broken).ok === false, 'the broken manifest validated')

  const n = (sql) => db.prepare(sql).get().n
  ingestManifest(broken, 'broken.json')
  is('a quarantined manifest leaves one manifests row', n(`SELECT COUNT(*) n FROM manifests`), 1)
  is('  …with status quarantined', n(`SELECT COUNT(*) n FROM manifests WHERE status = 'quarantined'`), 1)
  is('  …and zero nodes', n('SELECT COUNT(*) n FROM nodes'), 0)
  is('  …and zero edges', n('SELECT COUNT(*) n FROM edges'), 0)
  is('  …and zero evidence', n('SELECT COUNT(*) n FROM evidence'), 0)

  ingestManifest(good, 'payments-service.json')
  const first = {
    nodes: n('SELECT COUNT(*) n FROM nodes'),
    edges: n('SELECT COUNT(*) n FROM edges'),
    evidence: n('SELECT COUNT(*) n FROM evidence'),
    bindings: n('SELECT COUNT(*) n FROM contract_bindings'),
  }
  const ids = () => db.prepare('SELECT id FROM edges ORDER BY id').all().map((r) => r.id)
  const before = ids()

  // Same manifest, evidence and edges in a different order: the ids are a
  // function of the triple alone and must not move.
  const shuffled = structuredClone(good)
  shuffled.edges.reverse()
  for (const e of shuffled.edges) e.evidence.reverse()
  ingestManifest(shuffled, 'payments-service.json')

  is('re-ingest leaves one active manifest for the repo', n(`SELECT COUNT(*) n FROM manifests WHERE repo = 'payments-service' AND status = 'active'`), 1)
  is('  …and one superseded', n(`SELECT COUNT(*) n FROM manifests WHERE status = 'superseded'`), 1)
  is('re-ingest does not double nodes', n('SELECT COUNT(*) n FROM nodes'), first.nodes)
  is('re-ingest does not double edges', n('SELECT COUNT(*) n FROM edges'), first.edges)
  is('re-ingest does not double evidence', n('SELECT COUNT(*) n FROM evidence'), first.evidence)
  is('re-ingest does not double bindings', n('SELECT COUNT(*) n FROM contract_bindings'), first.bindings)
  ok('edge ids survive a reordered manifest', JSON.stringify(before) === JSON.stringify(ids()), 'edge ids changed')
  is(
    'the contract version lives in contract_bindings',
    db.prepare(`SELECT version FROM contract_bindings WHERE service_id = 'svc:payments-service'`).get()?.version,
    '3.2.0'
  )
  done()
}

/* ────────────────────────────── stage: estate (§14 Phase 2, 3 and search) */

if (stage === 'estate') {
  console.log('\nPhases 2–4 — the Meridian estate, over HTTP')
  const seed = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs')], {
    encoding: 'utf8',
    env: process.env,
  })
  if (seed.status !== 0) {
    console.log(`  ✗ seed:demo failed\n${seed.stdout}${seed.stderr}`)
    process.exit(1)
  }
  pass('seed:demo writes and ingests ten manifests')

  const express = (await import('express')).default
  const { router } = await import('../src/routes.js')
  const { db } = await import('../src/db.js')
  const app = express()
  app.use(express.json({ limit: '16mb' }))
  app.use('/api', router)
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const get = async (p) => {
    const res = await fetch(`${base}${p}`)
    return { status: res.status, body: await res.json() }
  }

  /* ---- §14 Phase 2: the counts */
  const { body: status } = await get('/status')
  is('services', status.counts.services, 10)
  is('kafka topics', status.counts.topics, 9)
  is('contracts', status.counts.contracts, 5)
  is('endpoints', status.counts.endpoints, 6)
  is('databases', status.counts.databases, 8)
  is('caches', status.counts.caches, 2)
  is('externals', status.counts.externals, 3)
  is('quarantined', status.counts.quarantined, 0)
  is('unresolved rows', status.counts.unresolved, 3)

  /* ---- §14 Phase 2: the findings */
  const { body: drift } = await get('/drift')
  const of = (kind) => drift.findings.filter((f) => f.kind === kind)
  is('exactly one no-producer', of('no-producer').length, 1)
  is('  …for risk.flagged.v1', of('no-producer')[0]?.subject_id, 'topic:risk.flagged.v1')
  is('exactly one shared-database', of('shared-database').length, 1)
  is('  …for postgres/ledger', of('shared-database')[0]?.subject_id, 'db:postgres/ledger')
  ok('at least three version-skew findings', of('version-skew').length >= 3, `got ${of('version-skew').length}`)
  for (const [name, versions] of [
    ['OrderMatched', ['3.2.0', '2.8.1']],
    ['UserCreated', ['3.2.0', '3.0.0']],
  ]) {
    const found = of('version-skew').find((f) => f.subject_id === `contract:com.meridian.events.${name}`)
    const bound = new Set((found?.data ?? []).map((b) => b.version))
    ok(
      `  …including ${name} (${versions.join(' vs ')})`,
      !!found && versions.every((v) => bound.has(v)),
      found ? `bound at ${[...bound].join(', ')}` : 'no finding for that contract'
    )
  }
  is('zero multiple-owners', of('multiple-owners').length, 0)

  /* ---- §14 Phase 3: the estate answers questions */
  const { body: topic } = await get(`/node?id=${encodeURIComponent('topic:users.created.v2')}`)
  is('users.created.v2 producers', topic.in.filter((e) => e.kind === 'kafka.produce').length, 1)
  is('users.created.v2 consumers', topic.in.filter((e) => e.kind === 'kafka.consume').length, 3)

  const { body: graph } = await get(`/graph?focus=${encodeURIComponent('svc:order-service')}&depth=1`)
  // Counted by hand off SPEC.md §12: three topics, one database, one cache,
  // four endpoints (three called, one exposed) and one contract, plus itself.
  is('graph around order-service at depth 1', graph.nodes.length, 11)
  const adjacent = new Set(
    db
      .prepare(`SELECT from_id, to_id FROM edges WHERE from_id = ? OR to_id = ?`)
      .all('svc:order-service', 'svc:order-service')
      .flatMap((e) => [e.from_id, e.to_id])
  )
  ok(
    '  …and only direct neighbours',
    graph.nodes.every((n) => adjacent.has(n.id)),
    `not adjacent: ${graph.nodes.filter((n) => !adjacent.has(n.id)).map((n) => n.id).join(', ')}`
  )

  /* ---- §14 Phase 3/4: search */
  const searches = [
    ['KafkaListener', 'evidence snippets are indexed'],
    ['GET /v1/rates/{}', 'a path with braces does not blow up FTS5'],
    ['payments.settled.v1', 'a dotted topic id does not blow up FTS5'],
    ['@KafkaListener', 'a leading @ does not blow up FTS5'],
    ['posting', 'a table name inside a SQL snippet is findable'],
  ]
  for (const [q, name] of searches) {
    const { status: code, body } = await get(`/search?q=${encodeURIComponent(q)}`)
    is(`search "${q}" → 200`, code, 200)
    ok(`  …${name}`, body.hits.length > 0, 'no hits')
  }
  const { body: kindFiltered } = await get(`/search?q=${encodeURIComponent('kind:topic orders')}`)
  ok(
    'an inline kind: filter narrows the results',
    kindFiltered.hits.length > 0 && kindFiltered.hits.every((h) => h.subject_id.startsWith('topic:')),
    `got ${kindFiltered.hits.map((h) => h.subject_id).join(', ')}`
  )

  /* ---- §14 Phase 3: the most important test in the suite */
  const subjectId = 'db:postgres/ledger'
  await fetch(`${base}/override`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subjectKind: 'node',
      subjectId,
      field: 'description',
      value: 'Corrected by hand: the book of record, and nothing else may write to it.',
    }),
  })
  const after = await get(`/node?id=${encodeURIComponent(subjectId)}`)
  ok('an override changes /api/node', after.body.node.description.startsWith('Corrected by hand'), after.body.node.description)

  const { ingestManifest } = await import('../src/ingest.js')
  const again = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'manifests', 'ledger-service.json'), 'utf8'))
  ingestManifest(again, 'ledger-service.json')
  const reingested = await get(`/node?id=${encodeURIComponent(subjectId)}`)
  ok(
    'and a re-ingest of that repo does NOT revert it',
    reingested.body.node.description.startsWith('Corrected by hand'),
    reingested.body.node.description
  )
  is('the estate is unchanged by the re-ingest', (await get('/status')).body.counts.services, 10)

  server.close()
  done()
}

function done() {
  console.log(`\n  ${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
