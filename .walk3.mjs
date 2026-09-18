import { chromium } from 'playwright'
const B='http://127.0.0.1:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', e=>console.log('PAGEERROR', e.message))
page.on('console', m=>m.type()==='error'&&console.log('CONSOLE', m.text()))
await page.goto(`${B}/`, {waitUntil:'networkidle'})
await page.waitForSelector('.map-node', {timeout:30000})
const before = (await page.$$('.react-flow__node')).length
console.log('nodes before', before)
// open the Process picker
await page.click('#picker-Process')
await page.waitForTimeout(300)
await page.fill('div[role=listbox] input[type=search]', 'Getting estimate')
await page.waitForTimeout(300)
const labels = await page.$$eval('div[role=listbox] .checkrow', els=>els.map(e=>e.innerText))
console.log('options', labels)
await page.click('div[role=listbox] .checkrow input')
await page.waitForTimeout(2000)
const after = (await page.$$('.react-flow__node')).length
const detail = await (await fetch(`${B}/api/process?code=2.1`)).json()
console.log('nodes after selecting L2.1:', after, 'components:', detail.components.length)
// now try to clear it
await page.click('#picker-Process')
await page.waitForTimeout(300)
const summaryBefore = await page.$eval('#picker-Process span', e=>e.textContent)
await page.fill('div[role=listbox] input[type=search]', 'Getting estimate')
await page.waitForTimeout(250)
await page.click('div[role=listbox] .checkrow input')
await page.waitForTimeout(800)
const summaryAfter = await page.$eval('#picker-Process span', e=>e.textContent)
console.log('picker summary before re-click:', JSON.stringify(summaryBefore), ' after re-click:', JSON.stringify(summaryAfter))
const after2 = (await page.$$('.react-flow__node')).length
console.log('nodes after re-click', after2)
await browser.close()
