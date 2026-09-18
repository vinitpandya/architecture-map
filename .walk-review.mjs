import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:8787'
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: exe })
const api = async (p) => (await fetch(`${BASE}/api${p}`)).json()

const { processes } = await api('/processes')
const { nodes } = await api('/graph?kinds=&includeExternal=true')

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
let problems = []
page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message))
page.on('console', (m) => m.type() === 'error' && problems.push('CONSOLE ' + m.text()))

async function visit(url, sel, label) {
  problems = []
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
  if (sel) { try { await page.waitForSelector(sel, { timeout: 8000 }) } catch (e) { problems.push('NOSEL ' + sel) } }
  await page.waitForTimeout(150)
  const side = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  if (side) problems.push('HSCROLL')
  if (problems.length) console.log(`✗ ${label}  ${problems.join(' | ')}`)
  return problems.slice()
}

console.log('--- process pages (list view)')
for (const p of processes) {
  await visit(`/process?code=${encodeURIComponent(p.code)}`, 'h1', `L${p.code}`)
}
console.log('--- process pages (diagram view)')
for (const p of processes.filter((p) => p.childCount > 0)) {
  problems = []
  await page.goto(`${BASE}/process?code=${encodeURIComponent(p.code)}`, { waitUntil: 'networkidle' })
  const btn = await page.$('button:has-text("Diagram")')
  if (!btn) { console.log(`  (no diagram toggle for L${p.code})`); continue }
  await btn.click()
  try { await page.waitForSelector('.proc-diagram svg', { timeout: 15000 }) }
  catch { problems.push('NO SVG') }
  const side = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  if (side) problems.push('HSCROLL')
  if (problems.length) console.log(`✗ diagram L${p.code}  ${problems.join(' | ')}`)
}
console.log('--- node pages')
for (const n of nodes) {
  await visit(`/node?id=${encodeURIComponent(n.id)}`, 'h1', `node ${n.id}`)
}
console.log('--- other')
await visit('/processes', '.proc-tree', 'processes tree')
await visit('/process?code=', null, 'process no code')
await visit('/process?code=9.9.9', null, 'process unknown code')
await visit('/process?code=L2.1', 'h1', 'process L-prefixed')
console.log('done')
await browser.close()
