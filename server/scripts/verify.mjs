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
  for (const s of ['ingest', 'estate', 'processes', 'packs', 'org']) {
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--stage=${s}`], {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATA_DIR: path.join(tmp, s),
        INBOX_DIR: path.join(tmp, s, 'inbox'),
        // The committed fixture, never whatever registry this machine happens
        // to have at the repo root — a stage must not depend on local state.
        TEAMS_FILE: path.join(ROOT, 'demo', 'teams.json'),
      },
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

  /* ---- what a fresh install answers, before anything has been ingested.
     SUM over zero rows is NULL in SQLite, and `covered` is declared a number. */
  {
    const express = (await import('express')).default
    const { router } = await import('../src/routes.js')
    const app = express()
    app.use('/api', router)
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/status`)
    const body = await res.json()
    is('an empty estate reports coverage.total as a number', typeof body.coverage.total, 'number')
    is('  …and coverage.covered as one too, not null', typeof body.coverage.covered, 'number')
    is('  …both zero', `${body.coverage.total}/${body.coverage.covered}`, '0/0')
    server.close()
  }

  /* ---- the standalone prompt pack is generated, so it cannot drift.

     `prompts/standalone/` is what somebody is handed to map a repository this
     app has never seen. It inlines the schema, so a schema edit that is not
     rebuilt hands them a copy that is quietly wrong — which is the exact class
     of error this whole project exists to catch. */
  {
    const built = spawnSync(process.execPath, [path.join(HERE, 'build-prompts.mjs'), '--check'], {
      encoding: 'utf8',
      env: process.env,
    })
    is('prompts/standalone/ is in sync with the schemas', built.status, 0, built.stdout + built.stderr)
    const dir = path.join(ROOT, 'prompts', 'standalone')
    for (const name of ['1-scan-a-repository.md', '2-author-a-process-pack.md']) {
      const body = fs.readFileSync(path.join(dir, name), 'utf8')
      is(`  …${name} has no unfilled placeholder`, /\{\{[A-Z_]+\}\}/.test(body), false)
      ok(`  …and carries the schema itself`, body.includes('"$id"'), 'no $id in the inlined schema')
    }
    ok(
      '  …and the folder stands alone',
      ['README.md', 'manifest.schema.json', 'process-pack.schema.json', 'example.manifest.json', 'example.process-pack.json']
        .every((f) => fs.existsSync(path.join(dir, f))),
      fs.readdirSync(dir).join(', ')
    )
  }

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
  const n = (sql) => db.prepare(sql).get().n

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

  // §8 says the default excludes contracts and §14's by-hand count includes
  // one, so both are asserted: the adjacency §14 is really about, with every
  // kind asked for, and the §8 default beside it.
  const ALL_KINDS = 'service,kafka.topic,database,cache,endpoint,contract,external'
  const { body: graph } = await get(
    `/graph?focus=${encodeURIComponent('svc:order-service')}&depth=1&kinds=${ALL_KINDS}`
  )
  // Counted by hand off SPEC.md §12: three topics, one database, one cache,
  // four endpoints (three called, one exposed) and one contract, plus itself.
  is('graph around order-service at depth 1', graph.nodes.length, 11)
  const { body: dflt } = await get(`/graph?focus=${encodeURIComponent('svc:order-service')}&depth=1`)
  is('  …and the default leaves the contract out, per §8', dflt.nodes.length, 10)
  is('  …', dflt.nodes.filter((n) => n.kind === 'contract').length, 0)
  ok('  …but still carries a degree on every node, per §8', dflt.nodes.every((n) => typeof n.degree === 'number'), 'a node came back without a degree')

  /* ---- the repos filter §8 documents and §10 puts in the filter row */
  const { body: byRepo } = await get('/graph?repos=payments-service')
  ok(
    'graph?repos= narrows to that repo',
    byRepo.nodes.length > 0 && byRepo.nodes.every((n) => n.ownerRepo === 'payments-service'),
    `${byRepo.nodes.length} nodes, repos ${[...new Set(byRepo.nodes.map((n) => n.ownerRepo))].join(', ')}`
  )
  const { body: noRepo } = await get('/graph?repos=does-not-exist')
  is('  …and an unknown repo is empty, not everything', noRepo.nodes.length, 0)

  /* ---- a repeated query parameter is ordinary HTTP, not a 500 */
  const twoKinds = await get('/drift?kind=no-producer&kind=version-skew')
  is('drift with a repeated kind returns 200', twoKinds.status, 200)
  is('  …and means both of them', twoKinds.body.findings.length, 4)
  is('  …as does the comma form', (await get('/drift?kind=no-producer,version-skew')).body.findings.length, 4)
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

  /* ---- overrides are the one table §15.4 says must survive a re-ingest, so a
     malformed write is refused rather than reinterpreted. better-sqlite3 reads
     an object as a named-parameter bag and spreads an array into the positional
     list, which wrote a row nobody asked for and answered 200. */
  const putOverride = (body) =>
    fetch(`${base}/override`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const overrideCount = () => n('SELECT COUNT(*) n FROM overrides')
  const beforeBad = overrideCount()
  is(
    'an override with an object subjectId is refused',
    (await putOverride({ subjectKind: 'node', subjectId: ['svc:gateway-api'], field: 'x', value: 'y' })).status,
    400
  )
  is(
    '  …and so is an object value',
    (await putOverride({ subjectKind: 'node', subjectId, field: 'description', value: { a: 1 } })).status,
    400
  )
  is('  …neither of which wrote anything', overrideCount(), beforeBad)
  is(
    '  …while a number is stored as the number, not SQLite\'s "42.0"',
    (await putOverride({ subjectKind: 'node', subjectId: 'svc:gateway-api', field: 'team', value: 42 })).status,
    200
  )
  is(
    '  …',
    db.prepare(`SELECT value FROM overrides WHERE subject_id = 'svc:gateway-api' AND field = 'team'`).get()?.value,
    '42'
  )
  await fetch(`${base}/override?subjectKind=node&subjectId=svc:gateway-api&field=team`, { method: 'DELETE' })

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

  /* ---- four screens key their refresh on lastIngestAt, and a pack that
     landed without a manifest beside it left every one of them stale. */
  const stampBefore = (await get('/status')).body.lastIngestAt
  ingestProcessPack(
    {
      schemaVersion: 1,
      pack: 'freshness-probe',
      name: 'Freshness probe',
      authoredAt: '2026-09-18T00:00:00Z',
      producer: { kind: 'import' },
      processes: [{ code: '7', name: 'Ingested without a manifest beside it' }],
    },
    'freshness-probe.json'
  )
  const afterPack = (await get('/status')).body.lastIngestAt
  ok(
    'a pack-only ingest moves lastIngestAt',
    afterPack && afterPack !== stampBefore,
    `${stampBefore} → ${afterPack}`
  )
  is('  …and the pack is in the log', n(`SELECT COUNT(*) n FROM process_packs WHERE pack = 'freshness-probe'`), 1)
  db.prepare(`DELETE FROM process_packs WHERE pack = 'freshness-probe'`).run()
  const { rebuildProcesses } = await import('../src/processes.js')
  const { linkPass } = await import('../src/link.js')
  rebuildProcesses()
  linkPass()

  /* ---- kind: narrows to a heading the search page actually shows */
  const { body: anyOrder } = await get('/search?q=order')
  ok(
    'searching finds processes as well as nodes and edges',
    anyOrder.hits.some((h) => h.subject_kind === 'process'),
    [...new Set(anyOrder.hits.map((h) => h.subject_kind))].join(', ')
  )
  const { body: procOnly } = await get(`/search?q=${encodeURIComponent('kind:process order')}`)
  ok(
    'kind:process narrows to them rather than returning nothing',
    procOnly.hits.length > 0 && procOnly.hits.every((h) => h.subject_kind === 'process'),
    `${procOnly.hits.length} hits: ${[...new Set(procOnly.hits.map((h) => h.subject_kind))].join(', ')}`
  )
  is(
    '  …and an unrecognised kind still matches nothing',
    (await get(`/search?q=${encodeURIComponent('kind:nonsense order')}`)).body.hits.length,
    0
  )

  /* ---- a `$`-bearing value must not be expanded as a replacement pattern.
     The pack box on /scan is free text, and `$\`` spliced the whole document
     back into itself. */
  for (const [label, value] of [
    ['a back-tick dollar', '$`'],
    ['a dollar-ampersand', '$&'],
    ['a dollar-quote', "$'"],
  ]) {
    const { body } = await get(`/prompt?name=author-processes&pack=${encodeURIComponent(value)}`)
    // Past the legend, which keeps its `{{PACK}}` on purpose.
    const after = body.text.slice(body.text.indexOf('-->') + 3)
    ok(
      `${label} pack id is inserted literally, not expanded`,
      after.includes(`authoring the pack \`${value}\``) && !after.includes('{{PACK}}'),
      `${body.text.length} chars`
    )
  }
  is(
    '  …and none of them changes the prompt\'s length',
    new Set(
      await Promise.all(
        ['plain', '$`', '$&'].map(async (v) => (await get(`/prompt?name=author-processes&pack=${encodeURIComponent(v)}`)).body.text.length - v.length)
      )
    ).size,
    1
  )

  /* ---- the authoring prompt (§8): it is the whole of how a pack gets written,
     and it is rendered rather than served flat. */
  const { body: prompt } = await get('/prompt?name=author-processes&pack=onboarding')
  const comment = prompt.text.slice(0, prompt.text.indexOf('-->') + 3)
  const body = prompt.text.slice(prompt.text.indexOf('-->') + 3)
  ok(
    'the authoring prompt keeps its placeholder legend',
    comment.includes('{{COMPONENTS}} → every component'),
    comment.slice(0, 400)
  )
  ok('  …and does not paste the schema into the comment', !comment.includes('"$id"'), `${comment.length} chars`)
  is(
    '  …so the schema appears once, in the body',
    prompt.text.split('"$id"').length - 1,
    1
  )
  ok(
    '  …every placeholder in the body is filled',
    !/\{\{[A-Z_]+\}\}/.test(body),
    (body.match(/\{\{[A-Z_]+\}\}/g) ?? []).join(', ')
  )
  ok('  …with the pack that was asked for', body.includes('authoring the pack `onboarding`'), 'pack not filled in')
  ok(
    '  …and the components and codes the author must not collide with',
    body.includes('`svc:order-service`') && body.includes('`L2.1.1`'),
    'components or codes missing'
  )

  /* ---- §8: "the existing focus/depth controls still work within that
     subgraph". Walking the whole estate and clipping afterwards counted hops
     through components outside the process, so a node could come back with no
     edge touching it at all. */
  {
    const { body } = await get(
      `/graph?process=1&focus=${encodeURIComponent('svc:gateway-api')}&depth=2`
    )
    const touched = new Set(body.edges.flatMap((e) => [e.from, e.to]))
    const stranded = body.nodes.map((n) => n.id).filter((id) => id !== 'svc:gateway-api' && !touched.has(id))
    is('a focused process graph strands no node', stranded.join(', '), '')
    ok(
      '  …and every node it returns is in the process',
      body.nodes.length > 0 && body.process === '1',
      `${body.nodes.length} nodes, process ${body.process}`
    )
  }
  {
    // A focus the process does not contain selects nothing, so the filter
    // stands alone rather than emptying the canvas. matching-engine is in
    // order-and-execution, not in reporting.
    const plain = (await get('/graph?process=3')).body
    ok(
      'the focus for this check really is outside the process',
      !plain.nodes.some((n) => n.id === 'svc:matching-engine'),
      'matching-engine turned out to be in process 3'
    )
    const { body } = await get(`/graph?process=3&focus=${encodeURIComponent('svc:matching-engine')}`)
    is('a focus outside the process leaves the process whole', body.nodes.length, plain.nodes.length)
  }

  /* ---- a `root` that is not a code, and a `maxLevel` that is not a number */
  is('processes?root=% is a 400, not 43 rows', (await get('/processes?root=%25')).status, 400)
  is('processes?maxLevel=abc is a 400, not an empty tree', (await get('/processes?maxLevel=abc')).status, 400)
  is('processes?root=2 still works', (await get('/processes?root=2')).body.processes.length, 20)

  /* ---- pack.source is an object here as it is everywhere else */
  {
    const { body } = await get('/process?code=2')
    is('/process returns pack.source parsed', typeof body.pack?.source, 'object')
    ok('  …with the fields the card reads', !!body.pack?.source?.asOf, JSON.stringify(body.pack?.source))
  }

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

  /* ---- two services exposing one route. The rollup used to collapse the
     exposer map on `to_id`, so a process kept whichever expose edge the scan
     returned last — losing the service that actually serves the endpoint it
     calls, and gaining a false uncovered-component, on ingest order alone. */
  {
    const { edgeId } = await import('../src/ingest.js')
    const { linkPass } = await import('../src/link.js')
    const endpoint = 'api:pricing-service/GET /v1/rates/{}'
    const mid = db.prepare(`SELECT id FROM manifests WHERE repo = 'gateway-api' AND status = 'active'`).get().id
    const expose = (from, repo) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO edges (id, manifest_id, from_id, to_id, kind, repo, confidence, first_seen, last_seen)
           VALUES (?, ?, ?, ?, 'http.expose', ?, 'high', '2026-01-01', '2026-01-01')`
        )
        .run(edgeId(from, 'http.expose', endpoint), mid, from, endpoint, repo)
    const pricingRows = () =>
      db
        .prepare(`SELECT process_id FROM process_components WHERE node_id = 'svc:pricing-service' ORDER BY process_id`)
        .all()
        .map((r) => r.process_id)
        .join(' ')
    const baseline = pricingRows()
    is('pricing-service is reached by the process that calls its endpoint', baseline, 'proc:2 proc:2.1 proc:2.1.2')

    expose('svc:gateway-api', 'gateway-api')
    linkPass()
    is('a second exposer does not displace the first', pricingRows(), baseline)
    is(
      '  …it is added beside it',
      n(`SELECT COUNT(*) n FROM process_components WHERE node_id = 'svc:gateway-api' AND via = 'exposes'`) > 0,
      true
    )
    is(
      '  …and raises no false uncovered-component',
      n(`SELECT COUNT(*) n FROM drift WHERE kind = 'uncovered-component' AND subject_id = 'svc:pricing-service'`),
      0
    )

    // The same estate with the rows written the other way round must answer the
    // same, or the link pass is not the deterministic rebuild it claims to be.
    db.prepare('DELETE FROM edges WHERE id = ?').run(edgeId('svc:pricing-service', 'http.expose', endpoint))
    expose('svc:pricing-service', 'pricing-service')
    linkPass()
    is('  …whichever order the two expose edges were written in', pricingRows(), baseline)

    db.prepare('DELETE FROM edges WHERE id = ?').run(edgeId('svc:gateway-api', 'http.expose', endpoint))
    linkPass()
    is('  …and removing it restores the estate exactly', pricingRows(), baseline)
  }

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

  /* ─── layer C: the team and handoff paths the demo estate cannot reach.

     Every one of these is a rule the demo data is too well-formed to exercise,
     which the polish pass showed is exactly where defects live. */

  /* a leaf with no owner takes its nearest ancestor's, not nothing */
  ingestProcessPack(
    envelope('probe-inherit', [
      { code: '7', name: 'Owned at the top', owner: 'trading' },
      { code: '7.1', name: 'Owned in the middle', owner: 'wallet' },
      { code: '7.1.1', name: 'Owned by nobody', node: 'svc:wallet-service' },
      { code: '7.2', name: 'Owned by nobody either' },
      { code: '7.2.1', name: 'Two levels from an owner' },
    ]),
    'probe-inherit.json'
  )
  const teamOf = (id) => db.prepare('SELECT team_id, team_via FROM processes WHERE id = ?').get(id)
  is('a process with an owner uses it', teamOf('proc:7.1')?.team_id, 'wallet')
  is('  …and says so', teamOf('proc:7.1')?.team_via, 'owner')
  is('a leaf with no owner inherits the nearest ancestor\'s', teamOf('proc:7.1.1')?.team_id, 'wallet')
  is('  …and says it was inherited', teamOf('proc:7.1.1')?.team_via, 'inherited')
  is('  …nearest, not the top', teamOf('proc:7.1.1')?.team_id === 'trading', false)
  is('two levels up still resolves', teamOf('proc:7.2.1')?.team_id, 'trading')
  is('  …also as inherited', teamOf('proc:7.2.1')?.team_via, 'inherited')
  is(
    'a level 2 with no owner is still a finding',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-no-owner' AND subject_id = 'proc:7.2'`),
    1
  )
  is(
    '  …but a leaf with no owner is not',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-no-owner' AND subject_id = 'proc:7.2.1'`),
    0
  )

  /* a declared handoff between two level 1s, which is where `support` used to
     be vacuous: process_components rolls up, so almost any two L1s intersect */
  ingestProcessPack(
    envelope('probe-support', [
      { code: '8', name: 'Claims a handoff to a whole other process', owner: 'trading', handsOffTo: [{ process: 'L9' }] },
      { code: '8.1', name: 'Does something', node: 'svc:order-service' },
      { code: '9', name: 'The other one', owner: 'data' },
      { code: '9.1', name: 'Does something else', node: 'svc:reporting-service' },
    ]),
    'probe-support.json'
  )
  is(
    'a declared L1 → L1 handoff with nothing direct in common is unsupported',
    db.prepare(`SELECT support FROM process_links WHERE from_id = 'proc:8' AND to_id = 'proc:9'`).get()?.support,
    'none'
  )
  is(
    '  …and is reported, which a rolled-up component set would have hidden',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-link-unsupported' AND subject_id = 'proc:8'`),
    1
  )

  /* a declaration written one level ABOVE the derived leaf handoff.

     Agreement is a property of the pair, not of whichever row happened to
     exist when the declaration was read — which is why the rollup runs before
     the declarations are matched. */
  ingestProcessPack(
    envelope('probe-agree', [
      { code: '11', name: 'Upstream', owner: 'trading', handsOffTo: [{ process: 'L12' }] },
      {
        code: '11.1',
        name: 'Publishes',
        owner: 'trading',
        node: 'svc:order-service',
        interaction: { from: 'svc:order-service', kind: 'kafka.produce', to: 'topic:orders.placed.v1' },
      },
      { code: '12', name: 'Downstream', owner: 'data' },
      {
        code: '12.1',
        name: 'Consumes',
        owner: 'data',
        node: 'svc:matching-engine',
        interaction: { from: 'svc:matching-engine', kind: 'kafka.consume', to: 'topic:orders.placed.v1' },
      },
    ]),
    'probe-agree.json'
  )
  ok(
    'the leaf handoff is derived',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:11.1' AND to_id = 'proc:12.1' AND derived = 1`) === 1,
    'no derived leaf link'
  )
  is(
    'a declaration written a level up marks the rolled-up row as agreed',
    db.prepare(`SELECT declared FROM process_links WHERE from_id = 'proc:11' AND to_id = 'proc:12' AND kind = 'kafka'`).get()?.declared,
    1
  )
  is(
    '  …rather than adding a second row beside it',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:11' AND to_id = 'proc:12' AND kind = 'declared'`),
    0
  )
  is(
    '  …and raises nothing, because the topology agrees',
    n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-link-unsupported' AND subject_id = 'proc:11'`),
    0
  )

  /* an orphan service has no team and no remedy, so it is not a finding */
  {
    const orphans = db.prepare(`SELECT id FROM nodes WHERE kind = 'service' AND orphan = 1`).all()
    ok('the demo estate has no orphan services to confuse this', orphans.length === 0, orphans.map((o) => o.id).join(', '))
    db.prepare(
      `INSERT OR REPLACE INTO nodes (id, kind, name, orphan, first_seen, last_seen)
       VALUES ('svc:somebody-elses-service', 'service', 'Somebody Elses Service', 1, '2026-01-01', '2026-01-01')`
    ).run()
    linkPass()
    is(
      'an orphan service with no team raises nothing',
      n(`SELECT COUNT(*) n FROM drift WHERE kind = 'component-no-team' AND subject_id = 'svc:somebody-elses-service'`),
      0
    )
    db.prepare(`UPDATE nodes SET orphan = 0 WHERE id = 'svc:somebody-elses-service'`).run()
    linkPass()
    is(
      '  …while a scanned service with no team does',
      n(`SELECT COUNT(*) n FROM drift WHERE kind = 'component-no-team' AND subject_id = 'svc:somebody-elses-service'`),
      1
    )
    db.prepare(`DELETE FROM nodes WHERE id = 'svc:somebody-elses-service'`).run()
    linkPass()
  }

  /* ---- and the demo estate is untouched by all of it */
  is('the ten demo services are still there', n(`SELECT COUNT(*) n FROM nodes WHERE kind = 'service'`), 10)
  is('the demo processes are still there', n(`SELECT COUNT(*) n FROM processes WHERE code = '2' OR code LIKE '2.%'`), 20)

  done()
}


/* ─────────────────────────── stage: org (SPEC-ORG.md §10, phases 12-13)

   Teams and handoffs. Runs against the committed demo registry at
   demo/teams.json, and separately against no registry at all, because
   "absent is a supported state" is a claim worth checking rather than
   asserting.
*/

if (stage === 'org') {
  console.log('\nPhases 12–13 — teams and handoffs')
  const seed = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs')], {
    encoding: 'utf8',
    env: process.env,
  })
  if (seed.status !== 0) {
    console.log(`  ✗ seed:demo failed\n${seed.stdout}${seed.stderr}`)
    process.exit(1)
  }

  const { db } = await import('../src/db.js')
  const { teamId } = await import('../src/teams.js')
  const { linkPass } = await import('../src/link.js')
  const n = (sql, ...a) => db.prepare(sql).get(...a).n
  const teamOf = (id) => db.prepare('SELECT team_id FROM nodes WHERE id = ?').get(id)?.team_id ?? null

  /* ---- §2: one normalisation rule, and it does not guess */
  is('teamId fixes case', teamId('Trading'), 'trading')
  is('  …and whitespace', teamId('  trading  '), 'trading')
  is('  …and separators', teamId('Risk_Ops'), 'risk-ops')
  is('  …and collapses runs', teamId('risk   ops'), 'risk-ops')
  is('  …but does not guess two strings are one team', teamId('Trading Team'), 'trading-team')
  is('  …and an empty value is no team at all', teamId('   '), '')

  /* ---- §5 team resolution, each of the three rules and the teamless cases */
  is('a service takes its own team', teamOf('svc:order-service'), 'trading')
  is('a database takes its owner\'s', teamOf('db:postgres/orders'), 'trading')
  is('an endpoint takes its exposer\'s', teamOf('api:pricing-service/GET /v1/rates/{}'), 'trading')
  is('a topic takes its producer\'s', teamOf('topic:orders.matched.v1'), 'trading')
  is('a cache with one writing team takes it', teamOf('cache:redis/pricing-quotes'), 'trading')
  is('a cache two teams write stays teamless', teamOf('cache:redis/session'), null)
  /* Fan-in onto a topic is deliberately not a defect in Layer A, so its
     `owner_repo` tiebreak was never meant to mean anything. Reading it as
     ownership would promote ingest order into an org fact. */
  is('a topic two teams publish has no team', teamOf('topic:notifications.requested.v1'), null)
  is('  …and says why', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'multi-team-topic' AND subject_id = 'topic:notifications.requested.v1'`), 1)
  is('  …exactly once', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'multi-team-topic'`), 1)
  is('topics with a team', n(`SELECT COUNT(*) n FROM nodes WHERE kind = 'kafka.topic' AND team_id IS NOT NULL`), 7)
  is('an external is nobody\'s', teamOf('ext:stripe'), null)
  is('a contract is nobody\'s', teamOf('contract:com.meridian.events.OrderMatched'), null)
  is('a topic nobody produces has nothing to inherit', teamOf('topic:risk.flagged.v1'), null)
  is('every service has a team', n(`SELECT COUNT(*) n FROM nodes WHERE kind = 'service' AND team_id IS NULL`), 0)
  is('every process has a team', n('SELECT COUNT(*) n FROM processes WHERE team_id IS NULL'), 0)
  is('  …every one of them from its own owner', n(`SELECT COUNT(*) n FROM processes WHERE team_via <> 'owner'`), 0)

  /* ---- an override outranks the scan, per SPEC.md §15.4 */
  db.prepare(
    `INSERT INTO overrides (subject_kind, subject_id, field, value, updated_at)
     VALUES ('node', 'svc:order-service', 'team', 'risk-ops', '2026-09-19T00:00:00Z')
     ON CONFLICT(subject_kind, subject_id, field) DO UPDATE SET value = excluded.value`
  ).run()
  linkPass()
  is('an override beats the manifest\'s team', teamOf('svc:order-service'), 'risk-ops')
  is('  …and carries to everything that inherits from it', teamOf('db:postgres/orders'), 'risk-ops')
  db.prepare(`DELETE FROM overrides WHERE subject_id = 'svc:order-service' AND field = 'team'`).run()
  linkPass()
  is('  …and removing it restores the scan\'s answer', teamOf('svc:order-service'), 'trading')

  /* ---- §2: the registry, present and absent */
  is('the demo registry has two departments', n('SELECT COUNT(*) n FROM departments'), 2)
  is('  …and eight registered teams', n('SELECT COUNT(*) n FROM teams WHERE registered = 1'), 8)
  is(
    '  …each in a department',
    n('SELECT COUNT(*) n FROM teams WHERE registered = 1 AND department_id IS NULL'),
    0
  )

  /* Absence is a supported state, and a claim worth running rather than
     asserting. TEAMS_FILE is resolved when config.js loads, so this needs a
     process of its own — which is also the real scenario: an install that
     never had a registry. */
  {
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { db } = await import('${path.join(ROOT, 'server', 'src', 'db.js')}')
         const { linkPass } = await import('${path.join(ROOT, 'server', 'src', 'link.js')}')
         linkPass()
         const n = (q) => db.prepare(q).get().n
         console.log(JSON.stringify({
           teams: n('SELECT COUNT(*) n FROM teams'),
           registered: n('SELECT COUNT(*) n FROM teams WHERE registered = 1'),
           departments: n('SELECT COUNT(*) n FROM departments'),
           unknown: n("SELECT COUNT(*) n FROM drift WHERE kind = 'unknown-team'"),
           orders: db.prepare("SELECT team_id t FROM nodes WHERE id = 'db:postgres/orders'").get().t,
         }))`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, TEAMS_FILE: path.join(process.env.DATA_DIR, 'no-such-registry.json') },
      }
    )
    const out = JSON.parse(probe.stdout.trim().split('\n').pop() || '{}')
    is('with no registry the teams are still all there', out.teams, 9)
    is('  …all of them unregistered', out.registered, 0)
    is('  …with no departments', out.departments, 0)
    is('  …and unknown-team does not fire against the whole organisation', out.unknown, 0)
    is('  …while the components keep their teams', out.orders, 'trading')
  }

  // That probe left the database registry-less; put it back.
  linkPass()
  is('putting the registry back re-registers them', n('SELECT COUNT(*) n FROM teams WHERE registered = 1'), 8)
  is('  …and the departments with them', n('SELECT COUNT(*) n FROM departments'), 2)

  /* ──────────────── §10 Phase 13: handoffs, derived and declared

     Counted over the direct rows. The rolled-up ones are the same facts
     restated a level up, and counting them would mean nothing. */
  const direct = `via = 'interaction'`
  is('direct handoffs', n(`SELECT COUNT(*) n FROM process_links WHERE ${direct}`), 9)
  is('  …derived from the topology', n(`SELECT COUNT(*) n FROM process_links WHERE derived = 1 AND ${direct}`), 8)
  is('  …of them crossing a team', n(`SELECT COUNT(*) n FROM process_links WHERE derived = 1 AND cross_team = 1 AND ${direct}`), 7)
  is('declared handoffs that became a row', n(`SELECT COUNT(*) n FROM process_links WHERE declared = 1 AND ${direct}`), 7)
  is('  …agreed with the topology', n(`SELECT COUNT(*) n FROM process_links WHERE declared = 1 AND derived = 1 AND ${direct}`), 6)
  is('direct handoffs crossing a team', n(`SELECT COUNT(*) n FROM process_links WHERE cross_team = 1 AND ${direct}`), 8)

  /* ---- the `touches` clause, and the topology check that keeps it a fact.
     A leaf may spend its one interaction slot on what it DOES with the message
     and name the topic in `touches` — SPEC-PROCESSES §3 blesses that shape — so
     reading only the interaction made the answer depend on which of two equally
     true facts the author wrote where. */
  ok(
    'a consumer that names the topic in touches is still a handoff',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:2.3.2' AND to_id = 'proc:2.3.3' AND derived = 1`) === 1,
    'trading → ledger over orders.matched.v1 is missing'
  )
  ok(
    '  …and so is identity → wallet over users.created.v2',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:1.1.2' AND to_id = 'proc:1.1.3' AND derived = 1`) === 1,
    'identity → wallet is missing'
  )
  is(
    '  …while a touches entry with no consuming edge derives nothing',
    n(`SELECT COUNT(*) n FROM process_links WHERE to_id = 'proc:2.3.4'`),
    0
  )
  ok(
    'a derived handoff cites the two edges it matched',
    n(`SELECT COUNT(*) n FROM process_links WHERE derived = 1 AND ${direct} AND (from_edge_id IS NULL OR to_edge_id IS NULL)`) === 0,
    'a derived handoff came back with no citation'
  )

  /* ---- a rolled-up row carries the LEAF pair's teams, not its own ends'.
     2.3.5 → 2.4.1 is wallet → growth; rolled up to 2.3 → 2.4 the row's own ends
     say trading → growth, and wallet → growth is the truth. */
  {
    const rolled = db
      .prepare(`SELECT from_team_id, to_team_id FROM process_links WHERE from_id = 'proc:2.3' AND to_id = 'proc:2.4'`)
      .get()
    is('a rolled-up handoff keeps the leaf pair\'s team', rolled?.from_team_id, 'wallet')
    is('  …not the ancestor\'s own owner, which is trading', db.prepare(`SELECT team_id FROM processes WHERE id = 'proc:2.3'`).get()?.team_id, 'trading')
  }
  // 6 derived + 19 of their rollups, plus the declared-only link and the 8
  // ancestor pairs it rolls into (3 froms x 3 tos, less the direct one).
  is('rows after rollup', n('SELECT COUNT(*) n FROM process_links'), 36)

  /* the handoff the whole feature exists to produce */
  const fill = db
    .prepare(
      `SELECT * FROM process_links WHERE from_id = 'proc:2.3.2' AND to_id = 'proc:3.1.2' AND ${direct}`
    )
    .get()
  ok('trading hands the fill to reporting', !!fill, 'no proc:2.3.2 → proc:3.1.2 row')
  is('  …over orders.matched.v1', fill?.via_node, 'topic:orders.matched.v1')
  is('  …derived from the topology', fill?.derived, 1)
  is('  …and the pack says so too', fill?.declared, 1)
  ok('  …citing the publish and the consume', !!fill?.from_edge_id && !!fill?.to_edge_id, JSON.stringify(fill))
  is('  …so it needs no finding', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-link-undocumented' AND subject_id = 'proc:2.3.2'`), 0)

  /* rolled up to the level a director reads */
  ok(
    'rolled up, L2 hands off to L3',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:2' AND to_id = 'proc:3'`) > 0,
    'no proc:2 → proc:3 row'
  )
  is('  …and nothing hands off to itself', n('SELECT COUNT(*) n FROM process_links WHERE from_id = to_id'), 0)
  is(
    '  …not even the internal handoff inside L2',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:2' AND to_id = 'proc:2'`),
    0
  )
  ok(
    '  …while the internal leaf handoff is still there',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:2.2.3' AND to_id = 'proc:2.2.4' AND cross_team = 0`) === 1,
    'the trading-to-trading handoff went missing'
  )

  /* §12.1 again: the thing most likely to have broken it is handsOffTo */
  const before = {
    nodes: n('SELECT COUNT(*) n FROM nodes'),
    edges: n('SELECT COUNT(*) n FROM edges'),
  }
  linkPass()
  is('a link pass creates no nodes', n('SELECT COUNT(*) n FROM nodes'), before.nodes)
  is('  …and no edges', n('SELECT COUNT(*) n FROM edges'), before.edges)
  is(
    'a declared handoff to a process nobody wrote creates no process',
    n(`SELECT COUNT(*) n FROM processes WHERE code = '4.1'`),
    0
  )

  /* ──────────── §5: which teams a process reaches, which is the HTTP case */
  const reach = db
    .prepare(`SELECT team_id, via, via_node FROM process_teams WHERE process_id = 'proc:2.1.3' ORDER BY via, via_node`)
    .all()
  is('a process reaches its own team as its owner', reach.filter((r) => r.via === 'owner')[0]?.team_id, 'trading')
  ok(
    '  …and identity through the endpoint it calls, not through a handoff',
    reach.some((r) => r.via === 'component' && r.team_id === 'identity' && r.via_node === 'api:identity-service/GET /v1/users/{}'),
    JSON.stringify(reach)
  )
  is(
    '  …with no handoff to any identity process, because a call is not a handoff',
    n(`SELECT COUNT(*) n FROM process_links WHERE from_id = 'proc:2.1.3'`),
    0
  )
  is(
    'distinct team pairs at leaf level',
    n(`SELECT COUNT(*) n FROM (SELECT DISTINCT p.team_id, t.team_id FROM process_teams t
        JOIN processes p ON p.id = t.process_id
        WHERE t.via = 'component' AND p.level = 3 AND p.team_id IS NOT NULL)`),
    13
  )
  is(
    '  …and across all levels, where the rollup widens them',
    n(`SELECT COUNT(*) n FROM (SELECT DISTINCT p.team_id, t.team_id FROM process_teams t
        JOIN processes p ON p.id = t.process_id
        WHERE t.via = 'component' AND p.team_id IS NOT NULL)`),
    22
  )

  /* ────────────────────── §10 Phase 14: the three deliberate defects */
  is('exactly one unknown-team', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'unknown-team'`), 1)
  is('  …and it is risk-ops', db.prepare(`SELECT subject_id FROM drift WHERE kind = 'unknown-team'`).get()?.subject_id, 'team:risk-ops')
  is('zero component-no-team', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'component-no-team'`), 0)
  is('zero process-no-owner', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-no-owner'`), 0)
  is('exactly one process-link-unknown-target', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-link-unknown-target'`), 1)
  is('  …from 1.2.3, naming L4.1', db.prepare(`SELECT subject_id FROM drift WHERE kind = 'process-link-unknown-target'`).get()?.subject_id, 'proc:1.2.3')
  is('exactly one process-link-unsupported', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-link-unsupported'`), 1)
  is('  …from 1.3.2, which shares nothing with 2.4.2', db.prepare(`SELECT subject_id FROM drift WHERE kind = 'process-link-unsupported'`).get()?.subject_id, 'proc:1.3.2')
  is('exactly one process-link-undocumented', n(`SELECT COUNT(*) n FROM drift WHERE kind = 'process-link-undocumented'`), 1)
  is('  …the wallet-to-data one nobody declared', db.prepare(`SELECT subject_id FROM drift WHERE kind = 'process-link-undocumented'`).get()?.subject_id, 'proc:2.3.5')
  is(
    '  …and a declared HTTP handoff is never reported as unsupported for being HTTP',
    n(`SELECT COUNT(*) n FROM process_links WHERE declared = 1 AND support = 'component'`),
    0
  )

  /* ──────────────────────── §10 Phase 15: the read API, over HTTP */
  {
    const express = (await import('express')).default
    const { router } = await import('../src/routes.js')
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

    const { body: all } = await get('/teams')
    is('/api/teams says the registry is configured', all.configured, true)
    is('  …and the demo registry has nothing wrong with it', all.problems.length, 0)
    is('  …and lists both departments', all.departments.length, 2)
    is('  …and every team, registered or not', all.teams.length, 9)
    const riskOps = all.teams.find((t) => t.id === 'risk-ops')
    is('  …marking the unregistered one', riskOps?.registered, false)
    is('  …and saying a pack is all that names it', riskOps?.source, 'process')
    is('  …which owns nothing in the estate', riskOps?.components, 0)

    const { body: wallet } = await get('/team?id=wallet')
    is('/api/team lists what it owns', wallet.components.length > 0, true)
    is('  …what it runs', wallet.processes.length, 4)
    is('  …who it hands off to', wallet.handoffs.out.length, 2)
    is('  …and who hands off to it', wallet.handoffs.in.length, 2)
    ok(
      '  …with both ends resolved, so a table needs no second call',
      wallet.handoffs.out.every((h) => h.to.name && h.to.teamName),
      JSON.stringify(wallet.handoffs.out[0])
    )
    is('an unknown team is a 404', (await get('/team?id=nobody')).status, 404)
    is('  …and an L-prefixed id still normalises', (await get('/team?id=Trading')).status, 200)

    const { body: hand } = await get('/handoffs?crossTeam=true')
    is('/api/handoffs returns the direct cross-team rows', hand.handoffs.length, 8)
    is(
      '  …and filters to one team',
      (await get('/handoffs?team=wallet')).body.handoffs.length,
      4
    )
    is(
      '  …and to the unsupported ones',
      (await get('/handoffs?support=none')).body.handoffs.length,
      1
    )

    /* the sentence the whole feature exists to produce */
    const { body: two } = await get('/process?code=2')
    const toReporting = two.links.out.filter((h) => h.to.code === '3')
    // Two rows, not one: the pair hands off over two topics, and the id carries
    // `via_node` precisely so those stay two facts.
    is('L2 hands off to L3', toReporting.length, 2)
    const matched = toReporting.find((h) => h.viaNode === 'topic:orders.matched.v1')
    ok('  …over orders.matched.v1', !!matched, JSON.stringify(toReporting.map((h) => h.viaNode)))
    is('  …which the pack agrees with', matched?.declared && matched?.derived, true)
    const balance = toReporting.find((h) => h.viaNode === 'topic:wallet.balance.changed.v1')
    is('  …and over wallet.balance.changed.v1, which nobody declared', balance?.declared, false)

    /* the list a level 1 would otherwise show nothing in */
    const { body: one1 } = await get('/process?code=1')
    is('a level 1 sees the handoffs inside it', one1.links.inside.length, 3)
    ok(
      '  …every one of them crossing a team',
      one1.links.inside.every((h) => h.crossTeam),
      JSON.stringify(one1.links.inside.map((h) => [h.from.code, h.to.code]))
    )
    is('  …and reaches five other teams', one1.teams.filter((t) => t.via !== 'owner').map((t) => t.id).filter((v, i, a) => a.indexOf(v) === i).length, 5)

    /* the HTTP case, on the page */
    const { body: check } = await get('/process?code=2.1.3')
    const identity = check.teams.filter((t) => t.id === 'identity')
    ok(
      'a process that calls an endpoint reaches that team through it',
      identity.some((t) => t.via === 'component' && t.viaNode.startsWith('api:identity-service/')),
      JSON.stringify(check.teams)
    )
    is('  …and hands off to nobody, because a call is not a handoff', check.links.out.length, 0)

    /* the map, filtered by team */
    const { body: g } = await get('/graph?teams=trading')
    ok(
      'graph?teams= narrows to that team',
      g.nodes.length > 0 && g.nodes.every((x) => x.teamId === 'trading'),
      `${g.nodes.length} nodes`
    )
    ok('  …and every node carries its team name', g.nodes.every((x) => x.teamName === 'Trading'), '')

    /* search finds a team by name, and its processes */
    const { body: q } = await get('/search?q=Wallet')
    ok(
      'searching a team name finds the team',
      q.hits.some((h) => h.subject_kind === 'team' && h.subject_id === 'team:wallet'),
      q.hits.map((h) => h.subject_id).slice(0, 6).join(', ')
    )
    is(
      '  …and kind:team narrows to teams',
      (await get(`/search?q=${encodeURIComponent('kind:team wallet')}`)).body.hits.every((h) => h.subject_kind === 'team'),
      true
    )

    /* an override re-links, rather than leaving every derived column stale */
    await fetch(`${base}/override`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectKind: 'node', subjectId: 'svc:order-service', field: 'team', value: 'risk-ops' }),
    })
    is(
      'an override re-runs the link pass rather than leaving team_id stale',
      db.prepare(`SELECT team_id FROM nodes WHERE id = 'db:postgres/orders'`).get()?.team_id,
      'risk-ops'
    )
    await fetch(`${base}/override?subjectKind=node&subjectId=svc:order-service&field=team`, { method: 'DELETE' })
    is('  …and deleting it re-runs the pass too', teamOf('db:postgres/orders'), 'trading')

    const { body: relinked } = await (async () => {
      const res = await fetch(`${base}/relink`, { method: 'POST' })
      return { body: await res.json() }
    })()
    is('POST /api/relink answers with what it rebuilt', relinked.teams, 8)
    is('  …and the handoff count', relinked.handoffs, 9)

    server.close()
  }

  /* ──── the registry checks itself.

     teamId() is what collapses two spellings into one team — which is the
     point of it — but two entries meaning one team is a mistake in the file,
     not a merge the author asked for. It used to happen silently, last writer
     winning, and a misspelt `department` quietly became no department at all.
     These are problems with a file rather than the estate disagreeing with
     itself, so they are served beside the teams and not as drift. */
  {
    const broken = path.join(process.env.DATA_DIR, 'broken-teams.json')
    const good = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'teams.json'), 'utf8'))
    fs.writeFileSync(
      broken,
      JSON.stringify({
        departments: good.departments,
        teams: [
          ...good.teams,
          { id: 'Trading', name: 'Trading Renamed', department: 'trading-platfrom' },
          { name: 'No id at all' },
        ],
      })
    )
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { rebuildTeams, registryProblems } = await import('${path.join(ROOT, 'server', 'src', 'teams.js')}')
         rebuildTeams()
         console.log(JSON.stringify(registryProblems()))`,
      ],
      { encoding: 'utf8', env: { ...process.env, TEAMS_FILE: broken } }
    )
    const found = JSON.parse(probe.stdout.trim().split('\n').pop() || '[]')
    const kinds = found.map((p) => p.kind).sort()
    is('two entries meaning one team is reported', kinds.filter((k) => k === 'duplicate-team').length, 1)
    is('  …a department nothing declares is reported', kinds.filter((k) => k === 'unknown-department').length, 1)
    is('  …and an entry with no usable id is reported', kinds.filter((k) => k === 'no-id').length, 1)
    is('  …and nothing else is', found.length, 3)
  }

  /* ---- removal takes Layer C with it */
  const removed = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs'), '--remove'], {
    encoding: 'utf8',
    env: process.env,
  })
  is('seed:demo --remove exits 0', removed.status, 0)
  is('  …clearing the handoffs', n('SELECT COUNT(*) n FROM process_links'), 0)
  is('  …and the team reach', n('SELECT COUNT(*) n FROM process_teams'), 0)
  is(
    '  …and every Layer C finding',
    n(`SELECT COUNT(*) n FROM drift WHERE kind LIKE 'process-link-%' OR kind IN ('unknown-team', 'component-no-team', 'process-no-owner')`),
    0
  )

  done()
}


function done() {
  console.log(`\n  ${checks - failures}/${checks} checks passed`)
  process.exit(failures ? 1 : 0)
}
