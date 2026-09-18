import { chromium } from 'playwright'
const B='http://127.0.0.1:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
let problems=[]
page.on('pageerror', e=>problems.push('PAGEERROR '+e.message))
page.on('console', m=>m.type()==='error'&&problems.push('CONSOLE '+m.text()))
for (const code of ['9','8','8.1','8.2','7','6','6.1']) {
  problems=[]
  await page.goto(`${B}/process?code=${code}`, {waitUntil:'networkidle'})
  await page.waitForTimeout(300)
  const h1 = await page.$eval('h1', e=>e.textContent).catch(()=>'(none)')
  const hasDiagram = !!(await page.$('button:has-text("Diagram")'))
  const side = await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)
  const text = await page.$eval('.page', e=>e.innerText.replace(/\s+/g,' ').slice(0,300)).catch(()=>'')
  console.log(`L${code}: h1="${h1}" diagramToggle=${hasDiagram} hscroll=${side} problems=${problems.join('|')||'none'}`)
  console.log('    ', text)
}
// the tree
problems=[]
await page.goto(`${B}/processes`, {waitUntil:'networkidle'})
await page.waitForSelector('.proc-tree')
console.log('tree problems', problems.join('|')||'none')
const roots = await page.$$eval('.proc-tree > .proc-row > .proc-line .proc-code', els=>els.map(e=>e.textContent))
console.log('roots', roots)
await browser.close()
