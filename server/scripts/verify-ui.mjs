#!/usr/bin/env node
/**
 * The verification steps that need a browser: SPEC.md §14 Phase 5 and
 * SPEC-PROCESSES.md §10 Phase 11. Everything else is `npm run verify`.
 *
 *   npm run build && npm run verify:ui
 *
 * It seeds a throwaway estate under data/verify-ui/, serves the production
 * build against it on a spare port, and drives Chromium at 1280×900. Nothing
 * it does touches your own database.
 *
 * Playwright ships the browser separately from the library. If the two are out
 * of step — a common state in a container with a pre-installed Chromium — this
 * finds whatever build is actually on disk rather than refusing to start.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DATA_DIR = path.join(ROOT, 'data', 'verify-ui')

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
const ok = (name, condition, detail = '') => (condition ? pass(name, detail) : fail(name, detail))

/* ────────────────────────────────────────────────────────────── the browser */

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error(
    'playwright is not installed. It is a devDependency of this repo:\n' +
      '  npm install\n' +
      'and, if this machine has no browser yet:\n' +
      '  npx playwright install chromium\n'
  )
  process.exit(2)
}

/** Whatever Chromium is actually on disk, whichever build number it carries. */
function findChromium() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.HOME ?? '', '.cache/ms-playwright')]
  for (const root of roots.filter(Boolean)) {
    if (!fs.existsSync(root)) continue
    for (const dir of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const full = path.join(root, dir, rel)
        if (fs.existsSync(full)) return full
      }
    }
  }
  return null
}

const dist = path.join(ROOT, 'web', 'dist', 'index.html')
if (!fs.existsSync(dist)) {
  console.error('web/dist is missing — run `npm run build` first.')
  process.exit(2)
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/* ─────────────────────────────────────────────────────── a throwaway estate */

fs.rmSync(DATA_DIR, { recursive: true, force: true })
const env = { ...process.env, DATA_DIR, INBOX_DIR: path.join(DATA_DIR, 'inbox') }
const seeded = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs')], { env, encoding: 'utf8' })
if (seeded.status !== 0) {
  console.error(`seed:demo failed\n${seeded.stdout}${seeded.stderr}`)
  process.exit(1)
}

const PORT = await freePort()
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
  env: { ...env, PORT: String(PORT) },
  stdio: 'ignore',
})
const BASE = `http://127.0.0.1:${PORT}`

const cleanup = () => {
  server.kill()
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
}
process.on('exit', cleanup)

// Wait for it, rather than sleeping and hoping.
for (let i = 0; i < 100; i++) {
  try {
    const res = await fetch(`${BASE}/api/status`)
    if (res.ok) break
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 100))
}

const api = async (p) => (await fetch(`${BASE}/api${p}`)).json()

/* ───────────────────────────────────────────────────────────────── checking */

const executablePath = findChromium() ?? undefined
const browser = await chromium.launch(executablePath ? { executablePath } : {})

const open = async (url, theme) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (theme) await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(String(e.message)))
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
  return { ctx, page, problems }
}

const noSideScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

const pages = await api('/dashboards')
const pageId = (slug) => pages.dashboards.find((d) => d.slug === slug)?.id
const setScope = (slug, scope) =>
  fetch(`${BASE}/api/dashboards/${pageId(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  })

const nodePositions = (page) =>
  page.$$eval('.react-flow__node', (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute('data-id'), e.style.transform]))
  )

/* ---- SPEC.md §14 Phase 5: the map */

console.log('\nSPEC.md §14 Phase 5 — the map')
await setScope('map', null)
{
  const { ctx, page, problems } = await open('/')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const first = await nodePositions(page)
  ok('the map renders', Object.keys(first).length > 0, `${Object.keys(first).length} nodes`)
  ok('no horizontal page scroll at 1280px', await noSideScroll(page))

  const arrow = await page.evaluate(async () => {
    const g = await (await fetch('/api/graph')).json()
    const e = g.edges.find((x) => x.kind === 'kafka.consume')
    const el = document.querySelector(`.react-flow__edge[data-id="${e.id}"]`)
    const p = el?.querySelector('path.react-flow__edge-path')
    if (!p) return null
    const end = p.getPointAtLength(p.getTotalLength())
    const centre = (id) => {
      const n = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
      if (!n) return null
      const m = new DOMMatrixReadOnly(getComputedStyle(n).transform)
      return { x: m.e + n.offsetWidth / 2, y: m.f + n.offsetHeight / 2 }
    }
    const away = (id) => {
      const c = centre(id)
      return c ? Math.hypot(end.x - c.x, end.y - c.y) : Infinity
    }
    return { label: el.getAttribute('aria-label'), service: away(e.from), topic: away(e.to) }
  })
  ok(
    'a kafka.consume edge points into the service',
    !!arrow && arrow.service < arrow.topic,
    arrow ? `${arrow.label} — ${Math.round(arrow.service)}px from the service, ${Math.round(arrow.topic)}px from the topic` : 'no edge found'
  )

  // A plain click: an edge's invisible hit stroke sitting over a node would
  // fail here, which is exactly what it should do.
  await page.click('.react-flow__node[data-id^="svc:"]', { timeout: 8000 })
  await page.waitForSelector('.map-inspector h3', { timeout: 5000 })
  pass('single click fills the inspector', await page.$eval('.map-inspector h3', (e) => e.textContent))
  ok('no console errors on the map', problems.length === 0, problems.join(' | '))
  await ctx.close()

  const second = await open('/')
  await second.page.waitForSelector('.map-node', { timeout: 30000 })
  await second.page.waitForTimeout(1200)
  const again = await nodePositions(second.page)
  const moved = Object.keys(first).filter((id) => first[id] !== again[id])
  ok(
    'loading the map twice puts every node in the same position',
    moved.length === 0,
    moved.length ? `${moved.length} moved` : `${Object.keys(again).length} nodes identical`
  )
  await second.ctx.close()
}

/* ---- SPEC-PROCESSES.md §10 Phase 11 */

console.log('\nSPEC-PROCESSES.md §10 Phase 11 — processes in the browser')
{
  const detail = await api('/process?code=2.1')
  await setScope('map', {
    focus: '',
    depth: '1',
    kinds: ['service', 'kafka.topic', 'database', 'cache', 'endpoint', 'contract', 'external'],
    repos: [],
    includeExternal: true,
    process: '2.1',
  })
  const { ctx, page, problems } = await open('/')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1400)
  is(
    'the map shows exactly the process’s components',
    (await page.$$('.react-flow__node')).length,
    detail.components.length
  )
  ok('no console errors with a process selected', problems.length === 0, problems.join(' | '))
  await ctx.close()
  await setScope('map', null)
}

for (const theme of ['light', 'dark']) {
  const { ctx, page, problems } = await open('/process?code=2.1', theme)
  await page.waitForSelector('.proc-flow', { timeout: 15000 })
  is(`${theme}: the list shows four actions in order`, (await page.$$('.proc-step')).length, 4)
  const codes = await page.$$eval('.proc-step .proc-code', (els) => els.map((e) => e.textContent))
  ok(`${theme}: and in code order`, codes.join(',') === 'L2.1.1,L2.1.2,L2.1.3,L2.1.4', codes.join(' '))

  await page.click('button:has-text("Diagram")')
  await page.waitForSelector('.proc-diagram svg', { timeout: 20000 })
  const messages = await page.$$eval('.proc-diagram svg text', (els) =>
    els.map((e) => e.textContent).filter((t) => /^2\.1\.\d/.test(t ?? ''))
  )
  is(`${theme}: the diagram draws four steps`, messages.length, 4)
  ok(`${theme}: in order`, messages.join(',') === messages.slice().sort().join(','), messages.join(' '))
  ok(`${theme}: the diagram has no horizontal page scroll`, await noSideScroll(page))
  ok(`${theme}: no console errors on the process page`, problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- every new screen, in the dark */

console.log('\nDark mode and layout, every new screen')
for (const [name, url, selector] of [
  ['processes tree', '/processes', '.proc-tree'],
  ['process detail', '/process?code=2', '.proc-flow'],
  ['process leaf', '/process?code=3.2.3', '.proc-binding'],
  ['node with processes', `/node?id=${encodeURIComponent('topic:orders.matched.v1')}`, '.card'],
  ['process map page', `/d/${pageId('processes')}`, '.proc-tree'],
  ['health', `/d/${pageId('health')}`, '[data-grid-id]'],
  ['scan', '/scan', '.prompt-box'],
  ['search for a process', '/search', 'input[type=search]'],
]) {
  const { ctx, page, problems } = await open(url, 'dark')
  await page.waitForSelector(selector, { timeout: 20000 })
  await page.waitForTimeout(500)
  const contrast = await page.evaluate(() => {
    const body = getComputedStyle(document.body)
    return { bg: body.backgroundColor, fg: body.color }
  })
  ok(`${name}: renders in dark mode`, !!contrast.bg, `${contrast.fg} on ${contrast.bg}`)
  ok(`${name}: no horizontal page scroll at 1280px`, await noSideScroll(page))
  ok(`${name}: no console errors`, problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- an unresolved reference is visible, never hidden */
{
  const { ctx, page } = await open('/process?code=3.1.1')
  await page.waitForSelector('.proc-binding', { timeout: 15000 })
  const missing = await page.$$eval('.proc-missing', (els) => els.map((e) => e.textContent))
  ok(
    'a component that is not in the map is shown as unresolved',
    missing.some((t) => (t ?? '').includes('trades.enriched.v1')),
    missing.join(', ') || 'nothing marked unresolved'
  )
  await ctx.close()
}

/* ---- …and an interaction that is missing does not defame its two ends.
   3.2.3 says reporting calls the wallet balance endpoint. Both components are
   real and one click away; it is the relationship the code does not have, and
   striking both of them through would be plainly false. */
{
  const { ctx, page } = await open('/process?code=3.2.3')
  await page.waitForSelector('.proc-binding', { timeout: 15000 })
  const marked = await page.$$eval('.proc-binding .proc-missing', (els) => els.map((e) => e.textContent))
  ok(
    'a missing interaction leaves its two real ends as links',
    marked.length === 0,
    `marked as not in the map: ${marked.join(', ')}`
  )
  const links = await page.$$eval('.proc-binding a', (els) => els.map((e) => e.textContent ?? ''))
  ok(
    '  …both of them, reporting-service and the wallet endpoint',
    links.some((t) => t.includes('reporting-service')) &&
      links.some((t) => t.includes('wallet-service')),
    links.join(', ') || 'no links in the binding'
  )
  const note = await page.$$eval('.proc-missing-note', (els) => els.map((e) => e.textContent ?? ''))
  ok(
    '  …and says the interaction itself is not in the map',
    note.some((t) => t.includes('not in the map')),
    note.join(', ') || 'no note'
  )
  await ctx.close()
}

/* ---- §8: "because the children are the flow, this works at every level —
   L2 draws four boxes". A level 1's stages carry no interaction of their own,
   and the diagram used to be withheld for exactly the case the spec names. */
for (const [code, expected] of [['2', 4], ['2.1', 4]]) {
  const { ctx, page, problems } = await open(`/process?code=${code}`)
  await page.waitForSelector('.proc-flow', { timeout: 15000 })
  const toggle = await page.$$(`button:has-text("Diagram")`)
  ok(`process ${code} offers the diagram`, toggle.length === 1, `${toggle.length} toggles`)
  if (toggle.length) {
    await toggle[0].click()
    await page.waitForSelector('.proc-diagram svg', { timeout: 20000 })
    const actors = await page.$$eval('.proc-diagram text.actor', (els) => els.length)
    const notes = await page.$$eval('.proc-diagram .note, .proc-diagram .noteText', (els) => els.length)
    ok(
      `  …and draws ${expected} steps for it`,
      (await page.$$eval('.proc-diagram .messageText, .proc-diagram .noteText', (els) => els.length)) >= expected,
      `actors ${actors}, notes ${notes}`
    )
    ok(`  …with no console error`, problems.length === 0, problems.join(' | '))
  }
  await ctx.close()
}

/* ---- §10's third Scan section: a drop zone, and the last sweep's result per
   file. The button existed; everything it produced was discarded. */
{
  const { ctx, page, problems } = await open('/scan')
  await page.waitForSelector('.prompt-box', { timeout: 20000 })
  is('scan has a file drop zone', await page.$$eval('.drop-zone', (els) => els.length), 1)
  is('  …with a file input behind it', await page.$$eval('.drop-zone input[type=file]', (els) => els.length), 1)
  const sweep = await page.$('button:has-text("Sweep inbox")')
  ok('  …and a sweep button beside it', !!sweep)
  await sweep.click()
  await page.waitForSelector('.ingest-results', { timeout: 20000 })
  is(
    '  …that reports what the sweep did rather than discarding it',
    (await page.$$eval('.ingest-results > li', (els) => els.length)) >= 1,
    true
  )
  /* §10 asks for relative time in the Repositories table, not an ISO string. */
  const scanned = await page.$$eval('[data-grid-id] td', (els) => els.map((e) => e.textContent ?? ''))
  is(
    '  …and the Scanned column is relative, not ISO',
    scanned.filter((t) => /^\d{4}-\d{2}-\d{2}T/.test(t.trim())).join(', '),
    ''
  )
  ok('  …with no console error', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- a service with no citation of its own is a gap in the schema, recorded
   in DECISIONS.md — not a bug to accuse the tool of on the node's own page. */
{
  const { ctx, page } = await open(`/node?id=${encodeURIComponent('svc:gateway-api')}`)
  await page.waitForSelector('.card', { timeout: 15000 })
  const text = await page.evaluate(() => document.body.innerText)
  is(
    'a node with no citation of its own does not claim the tool is broken',
    text.includes('Nothing should reach this state'),
    false
  )
  is('  …and says what is actually true instead', text.includes('its edges carry the evidence'), true)
  await ctx.close()
}

/* ---- an empty map under a filter is not an empty database */
{
  // A process and a kind that cannot both be true: 1.1.4 runs through a
  // service and a cache, so asking for topics inside it matches nothing.
  await setScope('map', {
    focus: '',
    depth: '1',
    kinds: ['kafka.topic'],
    repos: [],
    includeExternal: true,
    process: '1.1.4',
  })
  const { ctx, page } = await open('/')
  await page.waitForSelector('.empty', { timeout: 20000 })
  const text = await page.evaluate(() => document.body.innerText)
  is('an empty filtered map does not tell you to run the seeder', text.includes('seed:demo'), false)
  is('  …it points at the filter row', text.includes('Nothing matches these filters'), true)
  await ctx.close()
  await setScope('map', null)
}

/* ---- the two demo findings are the cross-check the process layer exists for,
   and on the Health page they used to arrive as bare slugs with no title and no
   explanation of what to do about them. */
{
  const { ctx, page } = await open(`/d/${pageId('health')}`)
  await page.waitForSelector('[data-grid-id], .drift-group, .empty', { timeout: 20000 })
  await page.waitForTimeout(600)
  const text = await page.evaluate(() => document.body.innerText)
  is(
    'no drift finding is shown as a raw slug',
    /process-missing-(component|interaction)|uncovered-component|process-(orphan|duplicate|no-detail)/.test(text),
    false
  )
  is(
    '  …the missing component has a title in the reader\'s terms',
    text.includes('Processes naming a component that is gone'),
    true
  )
  is(
    '  …and so does the missing interaction',
    text.includes('Calls a document describes and no code makes'),
    true
  )
  await ctx.close()
}

/* ---- and the same on a process page, which printed the slug too */
{
  const { ctx, page } = await open('/process?code=3.2.3')
  await page.waitForSelector('.proc-binding', { timeout: 15000 })
  const text = await page.evaluate(() => document.body.innerText)
  is('a process page names its finding rather than its slug', text.includes('process-missing-interaction'), false)
  is('  …', text.includes('Calls a document describes and no code makes'), true)
  await ctx.close()
}

/* ---- collapsing a branch survives an unrelated filter change. The widget
   fetches /processes through the shared scope params, so any control in the
   filter row refetched it and the reset threw the collapse away. */
{
  const { ctx, page } = await open(`/d/${pageId('processes')}`)
  await page.waitForSelector('.proc-tree', { timeout: 20000 })
  await page.waitForTimeout(500)
  const rows = () => page.$$eval('.proc-tree .proc-row', (els) => els.length)
  const before = await rows()
  const caret = await page.$('.proc-tree button[aria-expanded="true"]')
  ok('the tree has a branch to collapse', !!caret)
  await caret.click()
  await page.waitForTimeout(300)
  const collapsed = await rows()
  ok('collapsing a branch hides its children', collapsed < before, `${before} → ${collapsed}`)
  // Any control the tree does not read. includeExternal is the cheapest.
  const external = await page.$('.scope-bar input[type=checkbox]')
  if (external) {
    await external.click()
    await page.waitForTimeout(900)
    is('  …and an unrelated filter change does not re-expand it', await rows(), collapsed)
  } else {
    pass('  …(no filter-row checkbox on this page to test with)')
  }
  await ctx.close()
}

await browser.close()
console.log(`\n  ${checks - failures}/${checks} checks passed\n`)
process.exit(failures ? 1 : 0)
