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
 * Covers SPEC.md §14 (Layer A, phases 1–6) and SPEC-PROCESSES.md §10 (Layer B,
 * phases 7–11). The items neither can do here are the browser ones — stable
 * positions across two loads, arrow direction, mermaid, dark mode, horizontal
 * scroll. Those are `npm run verify:ui`.
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
  for (const s of ['ingest', 'estate', 'processes', 'packs']) {
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

/* ────────────────────── stage: processes (SPEC-PROCESSES.md §10, phases 7–9) */

if (stage === 'processes') {
  console.log('\nPhases 7–9 — process packs, over HTTP')
  const seed = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs')], {
    encoding: 'utf8',
    env: process.env,
  })
  if (seed.status !== 0) {
    console.log(`  ✗ seed:demo failed\n${seed.stdout}${seed.stderr}`)
    process.exit(1)
  }
  pass('seed:demo writes and ingests three process packs')

  const express = (await import('express')).default
  const { router } = await import('../src/routes.js')
  const { db } = await import('../src/db.js')
  const { ingestProcessPack } = await import('../src/processes.js')
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
  const one = (sql, ...a) => db.prepare(sql).get(...a)
  const n = (sql, ...a) => one(sql, ...a).n

  /* ---- §10 Phase 7: the contract, and the invariant that matters most */
  const cli = (file) =>
    spawnSync(process.execPath, [path.join(HERE, 'validate.mjs'), file], { encoding: 'utf8' })
  const example = path.join(ROOT, 'schema', 'example.order-and-execution.json')
  const run = cli(example)
  is('validate.mjs exits 0 on the example pack', run.status, 0)
  ok('  …and says it validated a process pack', run.stdout.includes('valid process pack'), run.stdout.trim())

  const fourSegments = path.join(process.env.DATA_DIR, 'four-segments.json')
  const pack = JSON.parse(fs.readFileSync(example, 'utf8'))
  const broken = structuredClone(pack)
  broken.processes.find((p) => p.code === '2.1.1').code = '2.1.1.4'
  fs.mkdirSync(path.dirname(fourSegments), { recursive: true })
  fs.writeFileSync(fourSegments, JSON.stringify(broken))
  const brokenRun = cli(fourSegments)
  is('a four-segment code exits 1', brokenRun.status, 1)
  ok(
    '  …naming the offending path',
    /\/processes\/\d+\/code/.test(brokenRun.stderr),
    brokenRun.stderr.trim()
  )

  const beforeQuarantine = {
    packs: n(`SELECT COUNT(*) n FROM process_packs WHERE status = 'quarantined'`),
    processes: n('SELECT COUNT(*) n FROM processes'),
  }
  ingestProcessPack(broken, 'four-segments.json')
  is(
    'a broken pack leaves exactly one more quarantined row',
    n(`SELECT COUNT(*) n FROM process_packs WHERE status = 'quarantined'`),
    beforeQuarantine.packs + 1
  )
  is('  …and imports zero processes', n('SELECT COUNT(*) n FROM processes'), beforeQuarantine.processes)

  const beforeTopology = {
    nodes: n('SELECT COUNT(*) n FROM nodes'),
    edges: n('SELECT COUNT(*) n FROM edges'),
  }
  const before = {
    processes: n('SELECT COUNT(*) n FROM processes'),
    active: n(`SELECT COUNT(*) n FROM process_packs WHERE status = 'active'`),
  }
  const prefixed = structuredClone(pack)
  for (const p of prefixed.processes) p.code = `L${p.code}`
  ingestProcessPack(prefixed, 'order-and-execution.json')

  is('an L-prefixed pack ingests to the same rows', n('SELECT COUNT(*) n FROM processes'), before.processes)
  is('  …leaving one active pack per pack id', n(`SELECT COUNT(*) n FROM process_packs WHERE status = 'active'`), before.active)
  ok('  …and proc:2.1.1 is still there', !!one(`SELECT 1 AS n FROM processes WHERE id = 'proc:2.1.1'`), 'proc:2.1.1 vanished')
  is(
    'INGESTING A PACK CREATES NO NODES',
    n('SELECT COUNT(*) n FROM nodes'),
    beforeTopology.nodes
  )
  is('INGESTING A PACK CREATES NO EDGES', n('SELECT COUNT(*) n FROM edges'), beforeTopology.edges)

  const row = one(`SELECT level, parent_id, sort_key FROM processes WHERE id = 'proc:2.1.1'`)
  is('proc:2.1.1 level', row.level, 3)
  is('proc:2.1.1 parent_id', row.parent_id, 'proc:2.1')
  is('proc:2.1.1 sort_key', row.sort_key, '0002.0001.0001')
  is(
    "all 15 of the example's leaves resolved to an edge",
    n(`SELECT COUNT(*) n FROM processes WHERE pack_id = (SELECT id FROM process_packs WHERE pack = 'order-and-execution' AND status = 'active') AND edge_id IS NOT NULL`),
    15
  )

  /* ---- §10 Phase 8: the rollup */
  const throwaway = db.prepare(
    `INSERT INTO processes (id, code, level, parent_id, sort_key, name, optional, pack_id, first_seen, last_seen)
     VALUES (?, ?, 2, 'proc:2', ?, 'throwaway', 0,
             (SELECT id FROM process_packs WHERE status = 'active' LIMIT 1), 'x', 'x')`
  )
  throwaway.run('proc:2.9', '2.9', '0002.0009')
  throwaway.run('proc:2.10', '2.10', '0002.0010')
  const bySort = db.prepare(`SELECT code FROM processes WHERE code IN ('2.9','2.10') ORDER BY sort_key`).all()
  const byCode = db.prepare(`SELECT code FROM processes WHERE code IN ('2.9','2.10') ORDER BY code`).all()
  ok('sort_key puts 2.9 before 2.10', bySort[0].code === '2.9', bySort.map((r) => r.code).join(' then '))
  ok('  …where ordering by code would not', byCode[0].code === '2.10', byCode.map((r) => r.code).join(' then '))
  db.prepare(`DELETE FROM processes WHERE code IN ('2.9','2.10')`).run()

  const compsOf = (id) =>
    new Set(db.prepare('SELECT node_id FROM process_components WHERE process_id = ?').all(id).map((r) => r.node_id))
  const parent = compsOf('proc:2')
  ok(
    'proc:2 rolls up every component of its descendants',
    db
      .prepare(`SELECT id FROM processes WHERE id LIKE 'proc:2.%'`)
      .all()
      .every((p) => [...compsOf(p.id)].every((c) => parent.has(c))),
    'a descendant component is missing from proc:2'
  )
  is(
    'proc:2.1.2 reaches pricing-service through the endpoint it calls',
    one(`SELECT via FROM process_components WHERE process_id = 'proc:2.1.2' AND node_id = 'svc:pricing-service'`)?.via,
    'exposes'
  )
  is(
    "  …while the component it names itself is via 'node'",
    one(`SELECT via FROM process_components WHERE process_id = 'proc:2.1.2' AND node_id = 'svc:order-service'`)?.via,
    'node'
  )
  is(
    "  …and on its parent the same component is via 'rollup'",
    one(`SELECT via FROM process_components WHERE process_id = 'proc:2.1' AND node_id = 'svc:order-service'`)?.via,
    'rollup'
  )

  /* ---- §10 Phase 9: the demo packs */
  const { body: status } = await get('/status')
  is('active process packs', status.counts.processPacks, 3)
  is('processes', status.counts.processes, 46)
  is('leaves', status.counts.processLeaves, 34)
  for (const [level, expected] of [[1, 3], [2, 9], [3, 34]]) {
    is(`level ${level}`, n('SELECT COUNT(*) n FROM processes WHERE level = ?', level), expected)
  }

  const { body: drift } = await get('/drift')
  const of = (kind) => drift.findings.filter((f) => f.kind === kind)
  is('exactly one process-missing-component', of('process-missing-component').length, 1)
  is('  …from 3.1.1', of('process-missing-component')[0]?.subject_id, 'proc:3.1.1')
  is(
    '  …for topic:trades.enriched.v1',
    of('process-missing-component')[0]?.data?.component,
    'topic:trades.enriched.v1'
  )
  is('exactly one process-missing-interaction', of('process-missing-interaction').length, 1)
  is('  …from 3.2.3', of('process-missing-interaction')[0]?.subject_id, 'proc:3.2.3')
  is('zero process-orphan-code', of('process-orphan-code').length, 0)
  is('zero process-duplicate-code', of('process-duplicate-code').length, 0)
  is('zero process-no-detail', of('process-no-detail').length, 0)
  is('exactly two uncovered-component', of('uncovered-component').length, 2)
  ok(
    '  …risk.flagged.v1 and notifications.requested.v1',
    of('uncovered-component')
      .map((f) => f.subject_id)
      .sort()
      .join(',') === 'topic:notifications.requested.v1,topic:risk.flagged.v1',
    of('uncovered-component').map((f) => f.subject_id).join(', ')
  )
  is(
    'every service is touched by some process',
    n(`SELECT COUNT(*) n FROM nodes WHERE kind = 'service' AND id NOT IN (SELECT node_id FROM process_components)`),
    0
  )

  /* ---- the questions the join exists to answer */
  const { body: matched } = await get(`/node?id=${encodeURIComponent('topic:orders.matched.v1')}`)
  const services = new Set((matched.processes ?? []).map((p) => p.code.split('.')[0]))
  ok(
    'orders.matched.v1 lists the ledger, wallet and reporting processes',
    ['2.3.3', '2.3.4', '3.1.2'].every((c) => (matched.processes ?? []).some((p) => p.code === c)),
    (matched.processes ?? []).map((p) => p.code).join(', ')
  )
  void services

  const { body: two } = await get('/process?code=2')
  const teams = new Set((two.services ?? []).map((s) => s.team).filter(Boolean))
  ok('process 2 crosses more than one team', teams.size > 1, [...teams].join(', '))
  const { body: prefixedRead } = await get('/process?code=L2')
  is('code=L2 reads the same process as code=2', prefixedRead.process?.id, two.process?.id)

  /* ---- search (§6) */
  for (const q of ['2.3.3', 'L2.3.3']) {
    const { body } = await get(`/search?q=${encodeURIComponent(q)}`)
    ok(`search "${q}" finds the process`, body.hits.some((h) => h.subject_id === 'proc:2.3.3'), body.hits.map((h) => h.subject_id).join(', '))
  }
  const { body: topicSearch } = await get(`/search?q=${encodeURIComponent('orders.matched.v1')}`)
  ok(
    'searching a topic finds the topic and the processes on it',
    topicSearch.hits.some((h) => h.subject_id === 'topic:orders.matched.v1') &&
      topicSearch.hits.some((h) => h.subject_kind === 'process'),
    topicSearch.hits.map((h) => h.subject_id).slice(0, 6).join(', ')
  )

  /* ---- removal */
  const removed = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs'), '--remove'], {
    encoding: 'utf8',
    env: process.env,
  })
  is('seed:demo --remove exits 0', removed.status, 0)
  is('  …clearing the packs', n(`SELECT COUNT(*) n FROM process_packs WHERE status = 'active'`), 0)
  is('  …and the processes', n('SELECT COUNT(*) n FROM processes'), 0)
  is('  …and the join tables', n('SELECT COUNT(*) n FROM process_components'), 0)
  is(
    '  …and leaving zero process findings',
    n(`SELECT COUNT(*) n FROM drift WHERE kind LIKE 'process-%' OR kind = 'uncovered-component'`),
    0
  )

  server.close()
  done()
}

/* ───────────────── stage: packs — the situations the demo estate cannot hold

   Every finding here was a real defect, found by reading the code rather than
   by running it, because the demo packs are deliberately well-formed and never
   reach any of these paths. They are asserted so they cannot come back.
*/

if (stage === 'packs') {
  console.log('\nPhases 7–8 — the pack situations the demo estate does not contain')
  const seed = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs')], {
    encoding: 'utf8',
    env: process.env,
  })
  if (seed.status !== 0) {
    console.log(`  ✗ seed:demo failed\n${seed.stdout}${seed.stderr}`)
    process.exit(1)
  }

  const { db } = await import('../src/db.js')
  const { ingestProcessPack } = await import('../src/processes.js')
  const { sweepInbox } = await import('../src/ingest.js')
  const n = (sql, ...a) => db.prepare(sql).get(...a).n
  const envelope = (pack, processes) => ({
    schemaVersion: 1,
    pack,
    name: pack,
    authoredAt: '2026-09-18T00:00:00Z',
    producer: { kind: 'import' },
    processes,
  })

  /* ---- a malformed document must not take the sweep down with it.
     `pack` is read off a body that has just failed validation, so it can hold
     anything; a bind parameter SQLite refuses would throw out of the ingest
     and abort every good file queued behind it. */
  let threw = null
  try {
    ingestProcessPack({ ...envelope('x', []), pack: { not: 'a string' } }, 'malformed-pack.json')
  } catch (err) {
    threw = err
  }
  ok('a pack whose id is not a string quarantines rather than throwing', !threw, String(threw))
  is(
    '  …filed under the file it came in as',
    db.prepare(`SELECT pack FROM process_packs WHERE source_file = 'malformed-pack.json'`).get()?.pack,
    'malformed-pack.json'
  )

  const { INBOX_DIR } = await import('../src/config.js')
  for (const sub of ['', 'quarantine', 'ingested']) {
    fs.mkdirSync(path.join(INBOX_DIR, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(INBOX_DIR, 'a-broken.json'),
    JSON.stringify({ ...envelope('inbox-broken', []), pack: 42 })
  )
  fs.writeFileSync(
    path.join(INBOX_DIR, 'b-good.json'),
    JSON.stringify(envelope('inbox-good', [{ code: '6', name: 'Swept in behind a broken file' }]))
  )
  let sweepThrew = null
  let swept = null
  try {
    swept = sweepInbox(INBOX_DIR)
  } catch (err) {
    sweepThrew = err
  }
  ok('one malformed file does not abort the inbox sweep', !sweepThrew, String(sweepThrew))
  is('  …the sweep reports both files', swept?.length, 2)
  is('  …one of them quarantined', swept?.filter((r) => !r.ok).length, 1)
  is('  …and the good pack behind it still landed', n(`SELECT COUNT(*) n FROM processes WHERE code = '6'`), 1)

  /* ---- a typo in `touches` must not hide a missing interaction.
     §5 suppresses the interaction finding when one of the interaction's OWN
     ends is missing — there the missing component is the root cause. An
     unrelated component is not a root cause for it. */
  ingestProcessPack(
    envelope('probe-shadow', [
      { code: '7', name: 'Probe' },
      {
        code: '7.1',
        name: 'Names one thing that is gone and one call nobody makes',
        node: 'svc:reporting-service',
        touches: ['topic:no.such.topic.v1'],
        interaction: {
          from: 'svc:reporting-service',
          kind: 'http.call',
          to: 'api:wallet-service/GET /v1/wallets/{}/balance',
        },
      },
    ]),
    'probe-shadow.json'
  )
  is(
    'a missing touches entry raises process-missing-component',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-missing-component' AND subject_id = 'proc:7.1'`),
    1
  )
  is(
    '  …and does NOT hide the missing interaction beside it',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-missing-interaction' AND subject_id = 'proc:7.1'`),
    1
  )

  /* ---- two packs claiming one code, then one of them re-ingested.
     `processes.code` is unique, so the single row can only hold one writer;
     clearing "this pack's rows" on re-ingest would take away a row the other
     pack still declares, and nothing would bring it back. */
  ingestProcessPack(
    envelope('probe-a', [
      { code: '8', name: 'Owned by A' },
      { code: '8.1', name: 'Only A declares this' },
      { code: '8.2', name: 'A and B both declare this' },
    ]),
    'probe-a.json'
  )
  ingestProcessPack(
    envelope('probe-b', [
      { code: '8.2', name: 'A and B both declare this' },
      { code: '8.3', name: 'Only B declares this' },
    ]),
    'probe-b.json'
  )
  is(
    'two packs declaring one code raise process-duplicate-code',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-duplicate-code' AND subject_id = 'proc:8.2'`),
    1
  )
  ingestProcessPack(envelope('probe-b', [{ code: '8.3', name: 'Only B declares this' }]), 'probe-b.json')
  is('re-ingesting the second pack keeps its own process', n(`SELECT COUNT(*) n FROM processes WHERE code = '8.3'`), 1)
  is('  …and does not delete the code it shared', n(`SELECT COUNT(*) n FROM processes WHERE code = '8.2'`), 1)
  is('  …or anything else the first pack declared', n(`SELECT COUNT(*) n FROM processes WHERE code = '8.1'`), 1)
  is(
    '  …and the shared code is owned by the pack that still declares it',
    db
      .prepare(
        `SELECT pk.pack AS pack FROM processes p JOIN process_packs pk ON pk.id = p.pack_id WHERE p.code = '8.2'`
      )
      .get()?.pack,
    'probe-a'
  )
  is(
    '  …with the duplicate finding gone now that only one pack claims it',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-duplicate-code' AND subject_id = 'proc:8.2'`),
    0
  )

  /* ---- a code whose parent was never declared. The finding is the point; a
     phantom parent in the join is not, because no page can open it. */
  ingestProcessPack(
    envelope('probe-orphan', [
      { code: '9', name: 'Declared' },
      { code: '9.4.1', name: 'Its parent 9.4 was never written', node: 'svc:ledger-service' },
    ]),
    'probe-orphan.json'
  )
  is(
    'a code whose parent is missing raises process-orphan-code',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-orphan-code' AND subject_id = 'proc:9.4.1'`),
    1
  )
  is('  …the process itself is still there', n(`SELECT COUNT(*) n FROM processes WHERE code = '9.4.1'`), 1)
  is('  …the parent it named is not invented', n(`SELECT COUNT(*) n FROM processes WHERE code = '9.4'`), 0)
  is(
    '  …and nothing rolls up into it',
    n(`SELECT COUNT(*) n FROM process_components WHERE process_id = 'proc:9.4'`),
    0
  )
  is(
    '  …nor into its grandparent, which is real but not its parent',
    n(`SELECT COUNT(*) n FROM process_components WHERE process_id = 'proc:9' AND node_id = 'svc:ledger-service'`),
    0
  )
  is(
    'every component row belongs to a process that exists',
    n(`SELECT COUNT(*) n FROM process_components pc
       WHERE NOT EXISTS (SELECT 1 FROM processes p WHERE p.id = pc.process_id)`),
    0
  )

  /* ---- a leaf with nothing under it and nothing bound to it */
  ingestProcessPack(
    envelope('probe-bare', [{ code: '5', name: 'A leaf that names no component at all' }]),
    'probe-bare.json'
  )
  is(
    'a leaf that binds nothing raises process-no-detail',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-no-detail' AND subject_id = 'proc:5'`),
    1
  )

  /* ---- and removing a pack has the same hole as re-ingesting one: the row
     it was holding may be a code somebody else still declares. */
  ingestProcessPack(
    envelope('probe-keeper', [{ code: '4', name: 'Shared with a pack about to go' }]),
    'probe-keeper.json'
  )
  ingestProcessPack(
    envelope('probe-leaver', [{ code: '4', name: 'Shared with a pack about to go' }]),
    'probe-leaver.json'
  )
  is(
    'the later pack holds the shared row',
    db
      .prepare(
        `SELECT pk.pack AS pack FROM processes p JOIN process_packs pk ON pk.id = p.pack_id WHERE p.code = '4'`
      )
      .get()?.pack,
    'probe-leaver'
  )
  const { rebuildProcesses } = await import('../src/processes.js')
  const { linkPass } = await import('../src/link.js')
  db.prepare(`DELETE FROM process_packs WHERE pack = 'probe-leaver'`).run()
  rebuildProcesses()
  linkPass()
  is('deleting it does not take the code the other pack declares', n(`SELECT COUNT(*) n FROM processes WHERE code = '4'`), 1)
  is(
    '  …the pack that still declares it now holds it',
    db
      .prepare(
        `SELECT pk.pack AS pack FROM processes p JOIN process_packs pk ON pk.id = p.pack_id WHERE p.code = '4'`
      )
      .get()?.pack,
    'probe-keeper'
  )

  /* ---- and the demo estate is untouched by all of it */
  is('the ten demo services are still there', n(`SELECT COUNT(*) n FROM nodes WHERE kind = 'service'`), 10)
  is('the demo processes are still there', n(`SELECT COUNT(*) n FROM processes WHERE code = '2' OR code LIKE '2.%'`), 20)

  done()
}


function done() {
  console.log(`\n  ${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
