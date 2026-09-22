#!/usr/bin/env node
/**
 * The checks that only fail in development.
 *
 *   npm run verify:dev
 *
 * `npm run verify:ui` drives the production build, which is the right thing to
 * assert about — it is what gets deployed. But it is not what anybody runs
 * while working: `npm run dev` serves the source through Vite and React's
 * development build, and two things are true there and nowhere else.
 *
 * React only warns about a render loop in development. `<StrictMode>` only
 * double-invokes renders, effects and memo factories in development, which is
 * precisely what turns an unstable `useMemo` dependency from a wasted
 * recomputation into a component that re-renders itself until React gives up.
 * A map that did that shipped green through both other suites, because
 * neither of them runs the build that says so.
 *
 * So this opens every page against the dev server and fails on any console
 * error at all. It is slower than the other two and needs no database of its
 * own beyond a throwaway estate.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DATA_DIR = path.join(ROOT, 'data', 'verify-dev')

let checks = 0
let failures = 0
const pass = (name, extra = '') => {
  checks++
  console.log(`  ✓ ${name}${extra ? `  ${extra}` : ''}`)
}
const fail = (name, detail) => {
  checks++
  failures++
  console.log(`  ✗ ${name}\n      ${detail}`)
}

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('playwright is not installed. It is a devDependency of this repo:\n  npm install\n')
  process.exit(1)
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

const free = () =>
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
const REGISTRY = path.join(DATA_DIR, 'teams.json')
fs.copyFileSync(path.join(ROOT, 'demo', 'teams.json'), REGISTRY)
const env = { ...process.env, DATA_DIR, INBOX_DIR: path.join(DATA_DIR, 'inbox'), TEAMS_FILE: REGISTRY }
const seeded = spawnSync(process.execPath, [path.join(HERE, 'seed-demo.mjs')], { env, encoding: 'utf8' })
if (seeded.status !== 0) {
  console.error(`seed:demo failed\n${seeded.stdout}${seeded.stderr}`)
  process.exit(1)
}

/* The dev server proxies /api to a fixed port, so the API has to be on the one
   vite.config.ts names rather than whatever happens to be free. */
const API_PORT = 8787
const WEB_PORT = await free()
const api = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
  env: { ...env, PORT: String(API_PORT) },
  stdio: 'ignore',
})
const web = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(WEB_PORT), '--strictPort'],
  { cwd: path.join(ROOT, 'web'), env, stdio: 'ignore' }
)
const BASE = `http://127.0.0.1:${WEB_PORT}`

const cleanup = () => {
  api.kill()
  web.kill()
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
}
process.on('exit', cleanup)

const up = async (url) => {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(url)).ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}
if (!(await up(`http://127.0.0.1:${API_PORT}/api/status`))) {
  console.error('the API never came up')
  process.exit(1)
}
if (!(await up(BASE))) {
  console.error('the dev server never came up')
  process.exit(1)
}

/* ───────────────────────────────────────────────────────────────── checking */

console.log('\nEvery page, against the dev server React actually warns in')

const browser = await chromium.launch(findChromium() ? { executablePath: findChromium() } : {})
const dashboards = await (await fetch(`http://127.0.0.1:${API_PORT}/api/dashboards`)).json()
const pageId = (slug) => dashboards.dashboards.find((d) => d.slug === slug)?.id

const visit = async (label, url) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(String(e.message)))
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
    // Long enough for a render loop to hit React's ceiling and say so.
    await page.waitForTimeout(9000)
  } catch (err) {
    problems.push(String(err).slice(0, 200))
  }
  /* A 404 for a favicon or a source map is the dev server being a dev server,
     not the app being wrong. Everything else counts. */
  const real = [...new Set(problems.filter((p) => !p.includes('404')))]
  if (real.length) fail(`${label}: no console errors`, real.slice(0, 3).join(' | ').slice(0, 500))
  else pass(`${label}: no console errors`)
  await ctx.close()
}

await visit('map', `/d/${pageId('map')}`)
await visit('estate', `/d/${pageId('estate')}`)
await visit('messaging', `/d/${pageId('messaging')}`)
await visit('contracts', `/d/${pageId('contracts')}`)
await visit('processes', `/d/${pageId('processes')}`)
await visit('teams', `/d/${pageId('teams')}`)
await visit('health', `/d/${pageId('health')}`)
await visit('process detail', '/process?code=2')
await visit('process leaf', '/process?code=2.3.2')
await visit('node', '/node?id=svc%3Aorder-service')
await visit('search', '/search?q=order')

await browser.close()
console.log(`\n  ${checks - failures}/${checks} checks passed\n`)
process.exit(failures ? 1 : 0)
