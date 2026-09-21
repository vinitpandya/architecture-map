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
fs.mkdirSync(DATA_DIR, { recursive: true })
// A copy of the committed fixture. The registry is writable from the Teams
// page now, and these checks rename and merge teams in it — against the repo
// root's `teams.json` that would edit whoever's actual org chart is on this
// machine, and against `demo/teams.json` it would edit the fixture.
const REGISTRY = path.join(DATA_DIR, 'teams.json')
fs.copyFileSync(path.join(ROOT, 'demo', 'teams.json'), REGISTRY)
const env = { ...process.env, DATA_DIR, INBOX_DIR: path.join(DATA_DIR, 'inbox'), TEAMS_FILE: REGISTRY }
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

/** The components on the map. An arrangement's group boxes are React Flow
 *  nodes as well, and none of these checks is ever asking about those. */
const MAP_NODE = '.react-flow__node:not(:has(.map-group))'

const nodePositions = (page) =>
  page.$$eval(MAP_NODE, (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute('data-id'), e.style.transform]))
  )

/** The map opens collapsed to services; most of these checks are about the
 *  scanned topology, which is the other detail level. */
const showEverything = async (page) => {
  await page.click('.map-detail button:has-text("Everything")')
  await page.waitForTimeout(1600)
}

const kindsOnScreen = (page) =>
  page.$$eval(MAP_NODE, (els) => [
    ...new Set(els.map((e) => e.getAttribute('data-id').split(':')[0])),
  ])

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

  /* ---- the service-level view, which is what the map opens on */

  const graph = await api('/graph')
  const collapsedKinds = await kindsOnScreen(page)
  ok(
    'the map opens collapsed to services',
    collapsedKinds.every((k) => k === 'svc' || k === 'ext'),
    collapsedKinds.join(', ')
  )
  const serviceCount = graph.nodes.filter((n) => n.kind === 'service').length
  is('  …and draws every service, including any nothing connects to',
    (await page.$$(MAP_NODE)).length, serviceCount)
  const relationKey = await page.$$eval('.map-legend .legend-item', (els) => els.map((e) => e.textContent.trim()))
  ok(
    '  …with a key naming what the lines stand for',
    ['Events', 'Calls', 'Shared stores'].every((l) => relationKey.includes(l)),
    relationKey.join(', ')
  )

  // Every collapsed line has to be derivable from two scanned edges, so the
  // count is checkable rather than a matter of taste. It is derived below,
  // from the topology this same map draws at the other detail level — the
  // filter row decides what is in the graph at all, and both views obey it.
  const collapsedEdges = (await page.$$('.react-flow__edge')).length

  // The key is a control, not a caption.
  const drawn = () => page.$$eval('.react-flow__edge', (els) => els.length)
  const withEvents = await drawn()
  await page.click('.map-legend .legend-item:has-text("Events")')
  await page.waitForTimeout(700)
  const withoutEvents = await drawn()
  ok('switching Events off in the key removes those lines', withoutEvents < withEvents,
    `${withEvents} → ${withoutEvents}`)
  ok('  …and the row stays in the key so it can be switched back on',
    (await page.$$('.map-legend .legend-item:has-text("Events")')).length === 1)
  await page.click('.map-legend .legend-item:has-text("Events")')
  await page.waitForTimeout(700)
  is('  …and switching it back on restores them', await drawn(), withEvents)

  // A derived line must be able to say what it collapsed.
  const derivedId = await page.$$eval('.react-flow__edge', (els) =>
    els.map((e) => e.getAttribute('data-id')).find((id) => /\|(event|call|store)\|/.test(id))
  )
  await page.click(`.react-flow__edge[data-id="${derivedId}"] .react-flow__edge-interaction`, { force: true })
  await page.waitForSelector('.map-through', { timeout: 5000 })
  const through = await page.$$eval('.map-through-list a', (els) => els.map((e) => e.textContent))
  ok('clicking a collapsed line says what it runs through', through.length > 0, through.join(', '))
  await page.click('.map-through [aria-label="Close"]')

  // The key itself.
  await page.click('.map-legend [aria-label="Hide the key"]')
  await page.waitForTimeout(300)
  is('the key can be switched off', (await page.$$('.map-legend .legend-item')).length, 0)
  await page.click('.map-legend [aria-label="Show the key"]')
  await page.waitForTimeout(300)
  ok('  …and back on', (await page.$$('.map-legend .legend-item')).length > 0)

  await showEverything(page)
  const fullKinds = await kindsOnScreen(page)
  ok(
    'Everything puts the topics and stores back',
    fullKinds.includes('topic') && fullKinds.includes('db'),
    fullKinds.join(', ')
  )

  const shownNodes = await page.$$eval(MAP_NODE, (els) => els.map((e) => e.getAttribute('data-id')))
  const shownEdges = await page.$$eval('.react-flow__edge', (els) => els.map((e) => e.getAttribute('data-id')))
  const expectedPairs = (() => {
    const OUT = { event: ['kafka.produce'], call: ['http.call'], store: ['db.write', 'db.owns', 'cache.write'] }
    const IN = { event: ['kafka.consume'], call: ['http.expose'], store: ['db.read', 'cache.read'] }
    const on = new Set(shownNodes)
    const kind = Object.fromEntries(graph.nodes.map((n) => [n.id, n.kind]))
    const edges = graph.edges.filter((e) => shownEdges.includes(e.id))
    const pairs = new Set()
    for (const rel of ['event', 'call', 'store']) {
      for (const a of edges.filter((e) => OUT[rel].includes(e.kind) && kind[e.from] === 'service')) {
        for (const b of edges.filter((e) => IN[rel].includes(e.kind) && e.to === a.to && e.from !== a.from)) {
          if (on.has(a.from) && on.has(b.from)) pairs.add(`${a.from}|${rel}|${b.from}`)
        }
      }
    }
    // An external has nothing on the far side to collapse into, so its edge
    // survives as itself.
    for (const e of edges) if (kind[e.to] === 'external') pairs.add(e.id)
    return pairs.size
  })()
  is('  …and the service view drew one line per pair of services per relationship',
    collapsedEdges, expectedPairs)

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

  /* ---- dragging, which is the point of the saved arrangement.

     The key is shut first: it floats over the canvas, and a drag that starts
     under it is a click on the key. That is true of the app as well as of the
     test, which is why the key can be shut at all. */

  await second.page.click('.map-legend [aria-label="Hide the key"]')
  await second.page.waitForTimeout(300)
  const before = await nodePositions(second.page)
  const target = await second.page.$('.react-flow__node[data-id^="svc:"]')
  const box = await target.boundingBox()
  await second.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await second.page.mouse.down()
  await second.page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 110, { steps: 12 })
  await second.page.mouse.up()
  await second.page.waitForTimeout(800)
  const after = await nodePositions(second.page)
  const dragged = Object.keys(before).filter((id) => before[id] !== after[id])
  is('a node can be dragged', dragged.length, 1)

  await second.page.reload({ waitUntil: 'networkidle' })
  await second.page.waitForSelector('.map-node', { timeout: 30000 })
  await second.page.waitForTimeout(1800)
  const reloaded = await nodePositions(second.page)
  ok(
    '  …and is still where it was put after a reload',
    dragged.every((id) => reloaded[id] === after[id]),
    dragged.map((id) => `${id}: ${after[id]}`).join(', ')
  )
  ok('  …while every other node stayed where the layout put it',
    Object.keys(before).filter((id) => !dragged.includes(id)).every((id) => reloaded[id] === before[id]))

  // The key was shut to drag under it; Reset layout lives inside it.
  await second.page.click('.map-legend [aria-label="Show the key"]')
  await second.page.waitForTimeout(300)
  await second.page.click('.map-reset')
  await second.page.waitForTimeout(1200)
  const reset = await nodePositions(second.page)
  ok('Reset layout puts it back where the layout wanted it',
    dragged.every((id) => reset[id] === before[id]))
  is('  …and the Reset control goes away with nothing left to reset',
    (await second.page.$$('.map-reset')).length, 0)
  await second.ctx.close()
}

/* ---- isolating a selection.

   The filter row's focus and depth ask the same question of the server. This
   asks it of what is already on screen, and the reason it exists is that a
   dense map has too many lines to read — so the check that matters is that the
   count actually drops and the way back is on screen. */
{
  const { ctx, page, problems } = await open('/')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await showEverything(page)
  const count = async () => (await page.$$(MAP_NODE)).length
  const whole = await count()

  is('the isolate control is not offered with nothing selected', (await page.$$('.map-isolate')).length, 0)
  await page.click('.react-flow__node[data-id="svc:order-service"]')
  await page.waitForTimeout(800)
  is('  …and appears once something is', (await page.$$('.map-isolate')).length, 1)

  await page.click('.map-isolate button:has-text("1")')
  await page.waitForTimeout(2200)
  const oneHop = await count()
  ok('one hop hides everything the selection does not touch', oneHop < whole, `${whole} → ${oneHop}`)

  // Checkable rather than a matter of taste: one hop is the node and its
  // neighbours in the graph the map is drawing.
  const graph = await api('/graph')
  const expected = new Set(['svc:order-service'])
  for (const e of graph.edges) {
    if (e.from === 'svc:order-service') expected.add(e.to)
    if (e.to === 'svc:order-service') expected.add(e.from)
  }
  const drawn = new Set(await page.$$eval(MAP_NODE, (els) => els.map((e) => e.getAttribute('data-id'))))
  is(
    '  …leaving exactly the node and its neighbours',
    [...drawn].filter((id) => !expected.has(id)).join(', '),
    ''
  )

  await page.click('.map-isolate button:has-text("2")')
  await page.waitForTimeout(2200)
  const twoHops = await count()
  ok('  …and two hops reaches further than one', twoHops > oneHop, `${oneHop} → ${twoHops}`)

  ok('the way back is on screen without opening the key', (await page.$$('.map-isolated')).length === 1)
  ok(
    '  …saying what it is isolated to and how much is hidden',
    (await page.$eval('.map-isolated', (e) => e.textContent ?? '')).includes('Order Service')
  )
  await page.click('.map-isolated button:has-text("Show the rest")')
  await page.waitForTimeout(2200)
  is('  …and taking it puts the map back', await count(), whole)

  /* An endpoint or a topic two hops out is the service behind it, which is the
     question this was built for. */
  await page.click('.react-flow__node[data-id="topic:orders.matched.v1"]')
  await page.waitForTimeout(700)
  await page.click('.map-isolate button:has-text("2")')
  await page.waitForTimeout(2200)
  const around = await page.$$eval(MAP_NODE, (els) => els.map((e) => e.getAttribute('data-id')))
  ok(
    'two hops from a topic reaches the services on the other side of it',
    around.includes('svc:ledger-service') && around.includes('svc:matching-engine'),
    around.filter((id) => id.startsWith('svc:')).join(', ')
  )
  ok('no console errors while isolating', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- the arrangements. One layout cannot answer every question, and the two
   with boxes are the ones that say something the layered one cannot. */
{
  const { ctx, page, problems } = await open('/')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await showEverything(page)
  const drawn = (await page.$$(MAP_NODE)).length
  const boxes = () => page.$$eval('.map-group-label', (els) => els.map((e) => e.textContent ?? ''))

  is('the map arranges itself compactly by default',
    await page.$eval('select[aria-label="Arrangement"]', (e) => e.value), 'compact')
  is('  …with no group boxes', (await boxes()).length, 0)

  await page.selectOption('select[aria-label="Arrangement"]', 'teams')
  await page.waitForTimeout(3000)
  const teams = await boxes()
  ok('Teams draws a box per team', teams.length > 1, teams.join(', '))
  ok('  …labelled with the team', teams.includes('Trading'), teams.join(', '))
  is('  …and draws every component it drew before', (await page.$$(MAP_NODE)).length, drawn)

  await page.selectOption('select[aria-label="Arrangement"]', 'columns')
  await page.waitForTimeout(2200)
  const columns = await boxes()
  ok('Columns draws a column per kind, counted', columns.some((c) => /^Services \(\d+\)$/.test(c)), columns.join(', '))
  // On the centre, not on the left edge: a column centres its nodes, so a
  // short name and a long one start at different x and sit in one column.
  const centres = await page.$$eval(MAP_NODE, (els) =>
    els
      .filter((e) => e.getAttribute('data-id').startsWith('svc:'))
      .map((e) => Math.round(new DOMMatrixReadOnly(getComputedStyle(e).transform).e + e.offsetWidth / 2))
  )
  // Within a pixel or two: a node's width is estimated from its label before
  // it is rendered, and the estimate is what centres it in the column.
  ok(
    '  …with every service centred in the same one',
    Math.max(...centres) - Math.min(...centres) <= 2,
    `spread ${Math.max(...centres) - Math.min(...centres)}px`
  )

  await page.selectOption('select[aria-label="Arrangement"]', 'crossings')
  await page.waitForTimeout(3500)
  is('Fewest crossings draws no boxes', (await boxes()).length, 0)
  is('  …and still every component', (await page.$$(MAP_NODE)).length, drawn)
  ok('no console errors across the arrangements', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- the chord: who talks to whom, when the topology is a hairball.

   Hand-written geometry rather than d3, so the numbers are worth asserting:
   an arc per service that connects to anything, a ribbon per derived line. */
{
  const { ctx, page, problems } = await open('/')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.click('.map-surface button:has-text("Chord")')
  await page.waitForTimeout(1600)

  const services = (await api('/graph')).nodes.filter((n) => n.kind === 'service').length
  is('the chord draws an arc per service', (await page.$$('.chord-arc')).length, services)
  const labels = await page.$$eval('.chord-label', (els) => els.map((e) => e.textContent ?? ''))
  ok('  …labelled', labels.includes('Order Service'), labels.join(', '))
  const ribbons = (await page.$$('.chord-ribbons path')).length
  ok('  …and a ribbon per service-to-service line', ribbons > 0, `${ribbons} ribbons`)

  ok('  …with a key naming what the ribbons are',
    (await page.$$eval('.map-legend .legend-item', (els) => els.map((e) => e.textContent.trim())))
      .includes('Shared stores'))
  await page.click('.map-legend .legend-item:has-text("Shared stores")')
  await page.waitForTimeout(900)
  ok('  …that switches them off, like the map\'s does',
    (await page.$$('.chord-ribbons path')).length < ribbons)
  await page.click('.map-legend .legend-item:has-text("Shared stores")')
  await page.waitForTimeout(900)

  await page.hover('.chord-label:has-text("Ledger Service")')
  await page.waitForTimeout(700)
  const note = await page.$eval('.chord-note', (e) => e.textContent ?? '')
  ok('hovering an arc says how much goes each way', /\d+ out, \d+ in/.test(note), note.trim().slice(0, 90))
  await page.click('.chord-label:has-text("Ledger Service")')
  await page.waitForTimeout(1200)
  is('clicking one opens it in the inspector',
    await page.$eval('.map-inspector h3', (e) => e.textContent), 'Ledger Service')

  await page.click('.map-surface button:has-text("Map")')
  await page.waitForTimeout(2500)
  ok('and the map comes back', (await page.$$('.map-node')).length > 0)
  ok('no console errors on the chord', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- an external is drawn as itself, because there is nothing on the far
   side to collapse into — and the key still has to own it. It was styled as a
   scanned edge and left behind when Calls was switched off, which is a key
   row claiming a line it does not cover. The map page's default scope leaves
   externals out, so this needs its own. */
{
  await setScope('map', {
    focus: '',
    depth: '1',
    kinds: ['service', 'kafka.topic', 'database', 'cache', 'endpoint', 'contract', 'external'],
    repos: [],
    includeExternal: true,
    process: '',
  })
  const { ctx, page, problems } = await open('/')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1600)
  const kinds = await kindsOnScreen(page)
  ok('an external survives the collapse as a node of its own', kinds.includes('ext'), kinds.join(', '))

  const strokes = await page.evaluate(() => {
    const stroke = (test) => {
      const el = [...document.querySelectorAll('.react-flow__edge')].find((e) => test(e.getAttribute('data-id')))
      return el ? getComputedStyle(el.querySelector('path.react-flow__edge-path')).stroke : null
    }
    const isDerived = (id) => /\|(event|call|store)\|/.test(id)
    return { external: stroke((id) => !isDerived(id)), call: stroke((id) => /\|call\|/.test(id)) }
  })
  ok(
    '  …drawn as the call it is, not as a scanned edge',
    !!strokes.external && strokes.external === strokes.call,
    `${strokes.external} against ${strokes.call}`
  )

  const before = (await page.$$('.react-flow__edge')).length
  const externals = await page.$$eval('.react-flow__edge', (els) =>
    els.filter((e) => !/\|(event|call|store)\|/.test(e.getAttribute('data-id'))).length
  )
  const derivedCalls = await page.$$eval('.react-flow__edge', (els) =>
    els.filter((e) => /\|call\|/.test(e.getAttribute('data-id'))).length
  )
  await page.click('.map-legend .legend-item:has-text("Calls")')
  await page.waitForTimeout(800)
  is('  …and goes when the key switches Calls off, with the rest of them',
    (await page.$$('.react-flow__edge')).length, before - externals - derivedCalls)
  ok('no console errors with externals on the map', problems.length === 0, problems.join(' | '))
  await ctx.close()
  await setScope('map', null)
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
  await showEverything(page)
  is(
    'the map shows exactly the process’s components',
    (await page.$$(MAP_NODE)).length,
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

/* ---- §8: the same rows, drawn five ways.

   Every one of these is generated from the children in order, so the test that
   matters for each is not "did mermaid run" but "is the thing this diagram
   exists to say actually on screen". */

const diagramText = (page) => page.$eval('.proc-diagram', (e) => e.textContent ?? '')

const openDiagram = async (page, kind) => {
  await page.waitForSelector('.proc-flow', { timeout: 15000 })
  await page.click('button:has-text("Diagram")')
  await page.waitForSelector('.proc-diagram svg', { timeout: 20000 })
  if (kind) {
    await page.selectOption('select[aria-label="Diagram"]', kind)
    await page.waitForTimeout(1400)
  }
}

{
  const { ctx, page, problems } = await open('/process?code=2')
  await openDiagram(page)
  const offered = await page.$$eval('select[aria-label="Diagram"] option', (els) => els.map((e) => e.value))
  is('a level 1 offers every diagram', offered.join(','), 'sequence,flow,lanes,handoffs,tree')

  /* ---- the flowchart */
  await page.selectOption('select[aria-label="Diagram"]', 'flow')
  await page.waitForTimeout(1400)
  const flow = await diagramText(page)
  ok('the flowchart opens on the trigger', flow.includes('A customer decides to trade'), flow.slice(0, 80))
  ok('  …and ends on the outcome', flow.includes('The trade is settled'))
  ok('  …drawing every child', ['L2.1', 'L2.2', 'L2.3', 'L2.4'].every((c) => flow.includes(c)), flow.slice(0, 200))

  /* ---- lanes, which is the diagram Layer C made possible */
  await page.selectOption('select[aria-label="Diagram"]', 'lanes')
  await page.waitForTimeout(1400)
  const lanes = await page.$$eval('.proc-diagram .cluster, .proc-diagram .cluster-label', (els) => els.length)
  ok('the lane diagram draws more than one lane', lanes > 1, `${lanes} lane elements`)
  ok(
    '  …and says the lanes are teams',
    (await page.evaluate(() => document.body.innerText)).includes('One lane per team')
  )

  /* ---- handoffs: one box per process, however many rows mention it.

     The rollup carries the LEAF pair's teams, so a rolled-up row puts this
     process under a team that is not its own — and drawing a box per row put
     "L2 Order and execution" in two different lanes at once. */
  await page.selectOption('select[aria-label="Diagram"]', 'handoffs')
  await page.waitForTimeout(1400)
  const boxes = await page.$$eval('.proc-diagram .nodeLabel', (els) => els.map((e) => e.textContent?.trim() ?? ''))
  const dupes = boxes.filter((b, i) => boxes.indexOf(b) !== i)
  is('the handoff diagram draws each process once', dupes.join(', '), '')
  ok('  …including the leaf crossings inside it', boxes.some((b) => b.startsWith('L2.3.2')), boxes.join(' | '))
  ok('  …and the topic that carries one', (await diagramText(page)).includes('orders.matched.v1'))

  /* ---- decomposition */
  await page.selectOption('select[aria-label="Diagram"]', 'tree')
  await page.waitForTimeout(1400)
  const tree = await diagramText(page)
  ok('the decomposition reaches level 3', tree.includes('L2.3.5'), tree.slice(0, 120))
  ok('no console errors across the five diagrams', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- a tab with nothing behind it is worse than a missing tab: it teaches
   the reader that the diagrams are unreliable. L2.1 is four steps, one team,
   one service, no handoffs and nothing below it. */
{
  const { ctx, page } = await open('/process?code=2.1')
  await openDiagram(page)
  const offered = await page.$$eval('select[aria-label="Diagram"] option', (els) => els.map((e) => e.value))
  is('a stage with one team and no handoffs offers only what it can draw', offered.join(','), 'sequence,flow')
  await ctx.close()
}

/* ---- §2: `next`, on screen. The conditions belong on the arrows, the ends
   are terminals, and a branch to a code nobody wrote is a dead end that says
   so rather than an arm that quietly is not drawn. */
{
  const { ctx, page } = await open('/process?code=2.1')
  await openDiagram(page, 'flow')
  const flow = await diagramText(page)
  ok('a decision draws both conditions on its arrows',
    flow.includes('the quote is still warm') && flow.includes('the cache has expired'), flow.slice(0, 200))
  ok('  …and an arm that stops the process draws its outcome', flow.includes('Estimate refused'))
  ok('  …with both outcomes, once each',
    (flow.match(/Estimate refused/g) ?? []).length === 1 && flow.includes('Estimate offered'))
  await ctx.close()
}

{
  const { ctx, page } = await open('/process?code=1.2')
  await openDiagram(page, 'flow')
  const flow = await diagramText(page)
  ok('a branch to a code nobody wrote is drawn as a dead end', flow.includes('not written'), flow.slice(0, 200))
  ok('  …naming the code it was pointed at', flow.includes('L4.2'))
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

/* ---- SPEC-ORG §10 Phase 16: the map on the process page.

   `/api/graph?process=` has always been able to serve this and nothing
   rendered it. It must show exactly what /api/process counts, at every level,
   and must NOT inherit whatever the map page's filter row was last set to. */
for (const code of ['1', '2.1', '2.3.5']) {
  const { ctx, page, problems } = await open(`/process?code=${code}`)
  await page.waitForSelector('.proc-binding, .proc-flow, .card', { timeout: 20000 })
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const drawn = await page.$$eval(MAP_NODE, (els) => els.length)
  const expected = (await api(`/process?code=${code}`)).components.length
  is(`process ${code}: the map draws every component`, drawn, expected)
  ok(`  …with no console error`, problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- colour by team, which has to be a mode rather than a second encoding:
   node kind already owns six of theme.css's eight categorical slots. */
{
  const { ctx, page } = await open('/process?code=2')
  await page.waitForSelector('.map-node', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const colourOf = () =>
    page.$$eval('.map-node', (els) =>
      els.map((e) => getComputedStyle(e).getPropertyValue('--node-color').trim())
    )
  const byKind = await colourOf()
  const legendByKind = await page.$$eval('.map-legend .legend-item, .map-legend li', (els) =>
    els.map((e) => e.textContent?.trim())
  )
  const toggle = await page.$('.map-legend button:has-text("Team")')
  ok('the map offers Colour by Team', !!toggle)
  await toggle.click()
  await page.waitForTimeout(900)
  const byTeam = await colourOf()
  ok(
    '  …and it re-tints the nodes',
    byKind.join() !== byTeam.join(),
    `${new Set(byKind).size} kind colours, ${new Set(byTeam).size} team colours`
  )
  const legendByTeam = await page.$$eval('.map-legend .legend-item, .map-legend li', (els) =>
    els.map((e) => e.textContent?.trim())
  )
  ok(
    '  …and the legend lists teams instead of kinds',
    legendByTeam.some((t) => (t ?? '').includes('Trading')) &&
      !legendByTeam.some((t) => (t ?? '').includes('Kafka topic')),
    `${legendByKind.join(', ')}  →  ${legendByTeam.join(', ')}`
  )
  const kindBtn = await page.$('.map-legend button:has-text("Kind")')
  await kindBtn.click()
  await page.waitForTimeout(700)
  is('  …and switching back restores exactly the previous colours', (await colourOf()).join(), byKind.join())
  await ctx.close()
}

/* ---- the team pages, and the seeded dashboard */
{
  const pages = await api('/dashboards')
  const teamsPage = pages.dashboards.find((d) => d.slug === 'teams')
  ok('a Teams and handoffs page is seeded', !!teamsPage, pages.dashboards.map((d) => d.slug).join(', '))

  for (const [name, url, selector] of [
    ['teams', '/teams', 'table'],
    ['one team', '/team?id=wallet', '.handoff-list'],
    ['a team the registry lacks', '/team?id=risk-ops', '.card'],
    ['the seeded teams page', `/d/${teamsPage.id}`, '[data-grid-id]'],
  ]) {
    const { ctx, page, problems } = await open(url, 'dark')
    await page.waitForSelector(selector, { timeout: 20000 })
    await page.waitForTimeout(500)
    ok(`${name}: no horizontal page scroll at 1280px`, await noSideScroll(page))
    ok(`${name}: no console errors`, problems.length === 0, problems.join(' | '))
    await ctx.close()
  }
}

/* ---- and a team that owns nothing says so, rather than showing a bare 0 */
{
  const { ctx, page } = await open('/teams')
  await page.waitForSelector('table', { timeout: 20000 })
  const text = await page.evaluate(() => document.body.innerText)
  is('an unregistered team is marked on the teams page', text.includes('unregistered'), true)
  is('  …and the page says why it matters', text.includes('not in the registry'), true)
  await ctx.close()
}

/* ---- SPEC-ORG §2: the registry is editable, because a scan names teams after
   whoever is in the commit history. Everything here writes the throwaway
   registry copied above, never the one at the repo root. */
{
  const { ctx, page, problems } = await open('/teams')
  await page.waitForSelector('select[aria-label="Team for Gateway API"]', { timeout: 20000 })
  await page.waitForTimeout(500)

  /* ---- a service's team, from the grid */
  const teamOf = async (id) => (await api(`/node?id=${encodeURIComponent(id)}`)).node
  await page.selectOption('select[aria-label="Team for Gateway API"]', 'ledger')
  await page.waitForTimeout(2200)
  const moved = await teamOf('svc:gateway-api')
  is('the services grid puts a service in a team', moved.teamId, 'ledger')
  is('  …recording it as a correction rather than a scan', moved.teamVia, 'override')
  ok(
    '  …and says so on the row',
    await page.$$eval('tr', (rows) =>
      [...rows].some((r) => r.textContent.includes('Gateway API') && r.textContent.includes('corrected'))
    )
  )
  await page.click('tr:has-text("Gateway API") button:has-text("Revert to the scan")')
  await page.waitForTimeout(2200)
  is('  …and reverting gives the manifest back', (await teamOf('svc:gateway-api')).teamId, 'platform')

  /* ---- renaming, and the id the editor promised.

     `teamIdOf` on the client states SPEC-ORG §2's rule a second time so the
     editor can say what the id will become before the request goes. This is
     the check that stops the two drifting apart. */
  await page.click('button:has-text("Name it")')
  await page.waitForSelector('.modal', { timeout: 5000 })
  await page.fill('.modal input[value="risk-ops"]', 'Risk Operations')
  await page.waitForTimeout(200)
  const promised = await page.$eval('.modal p', (e) => e.textContent)
  ok('the editor says what the id will become', promised.includes('risk-operations'), promised.trim())
  await page.click('.modal button:has-text("Save")')
  await page.waitForTimeout(2500)
  is('  …and the server agrees with it', new URL(page.url()).searchParams.get('id'), 'risk-operations')
  is('  …landing on the renamed team', await page.$eval('h1', (e) => e.textContent.trim()), 'Risk Operations')
  ok(
    '  …which says what it also answers to',
    (await page.evaluate(() => document.body.innerText)).includes('risk-ops')
  )
  is('  …and is registered now', (await api('/teams')).teams.find((t) => t.id === 'risk-operations')?.registered, true)

  /* ---- merging, from the same editor */
  await page.click('button:has-text("Edit team")')
  await page.waitForSelector('.modal select[aria-label="Merge into"]', { timeout: 5000 })
  await page.selectOption('.modal select[aria-label="Merge into"]', 'trading')
  await page.waitForTimeout(200)
  await page.click('.modal button:has-text("Merge Risk Operations into Trading")')
  await page.waitForTimeout(2500)
  is('merging lands on the surviving team', await page.$eval('h1', (e) => e.textContent.trim()), 'Trading')
  const trading = (await api('/teams')).teams.find((t) => t.id === 'trading')
  is('  …which keeps both spellings', trading?.aliases.join(), 'risk-operations,risk-ops')
  is('  …and the absorbed team is gone', (await api('/teams')).teams.some((t) => t.id === 'risk-operations'), false)

  /* ---- and the undo */
  await page.click('button:has-text("Edit team")')
  await page.waitForSelector('.modal', { timeout: 5000 })
  await page.click('.modal button[aria-label="Stop treating risk-ops as this team"]')
  await page.waitForTimeout(2500)
  is('removing an alias un-merges it', (await api('/teams')).teams.some((t) => t.id === 'risk-ops'), true)

  ok('no console errors while editing teams', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- the same correction, one service at a time, on the node page */
{
  const { ctx, page, problems } = await open('/node?id=svc%3Awallet-service')
  await page.waitForSelector('select[aria-label="Team"]', { timeout: 15000 })
  is('a service page offers its team', await page.$eval('select[aria-label="Team"]', (e) => e.value), 'wallet')
  await page.selectOption('select[aria-label="Team"]', 'ledger')
  await page.waitForTimeout(2200)
  is('  …and changing it takes', (await api('/node?id=svc%3Awallet-service')).node.teamId, 'ledger')
  await page.click('button:has-text("Revert to the scan")')
  await page.waitForTimeout(2200)
  is('  …and reverting restores the scan', (await api('/node?id=svc%3Awallet-service')).node.teamId, 'wallet')
  ok('no console errors on the node page', problems.length === 0, problems.join(' | '))
  await ctx.close()
}

/* ---- a topic has no team of its own to set, and says where its came from */
{
  const { ctx, page } = await open('/node?id=topic%3Aorders.matched.v1')
  await page.waitForSelector('h1', { timeout: 15000 })
  await page.waitForTimeout(400)
  is(
    'an inherited team is not offered as something to set',
    (await page.$$('select[aria-label="Team"]')).length,
    0
  )
  ok(
    '  …but the team it inherited is a link',
    await page.$$eval('a', (els) => els.some((e) => e.getAttribute('href')?.startsWith('/team?id=')))
  )
  await ctx.close()
}

await browser.close()
console.log(`\n  ${checks - failures}/${checks} checks passed\n`)
process.exit(failures ? 1 : 0)
