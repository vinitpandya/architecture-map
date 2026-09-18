import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
const res = await page.evaluate(async () => {
  const mod = await import('/node_modules/.vite/deps/mermaid.js')
  const m = mod.default
  if (!m || typeof m.render !== 'function') return { err: 'no mermaid', keys: Object.keys(mod) }
  m.initialize({ startOnLoad: false, securityLevel: 'strict' })
  const cases = {
    noParticipantsNote: 'sequenceDiagram\n  autonumber\n  Note over P0: 2.1 Getting estimate\n  Note over P0: 2.2 Accepting estimate',
    declaredNote: 'sequenceDiagram\n  autonumber\n  participant P0 as Order Service\n  Note over P0: 2.1 Getting estimate',
    comma: 'sequenceDiagram\n  participant P0 as Order, Service\n  participant P1 as B\n  P0->>P1: hello',
    parens: 'sequenceDiagram\n  participant P0 as Order (main)\n  participant P1 as B\n  P0->>P1: 2.1 do (a) thing',
    dash: 'sequenceDiagram\n  participant P0 as order-service\n  participant P1 as B\n  P0->>P1: x - y',
    plus: 'sequenceDiagram\n  participant P0 as a+b\n  participant P1 as B\n  P0->>P1: x',
    endword: 'sequenceDiagram\n  participant P0 as end\n  participant P1 as B\n  P0->>P1: x',
    pct: 'sequenceDiagram\n  participant P0 as 50% off\n  participant P1 as B\n  P0->>P1: x',
    brace: 'sequenceDiagram\n  participant P0 as GET /v1/rates/{}\n  participant P1 as B\n  P0->>P1: x',
    amp: 'sequenceDiagram\n  participant P0 as A & B\n  participant P1 as B\n  P0->>P1: x',
    arrowInName: 'sequenceDiagram\n  participant P0 as a->>b\n  participant P1 as B\n  P0->>P1: x',
    noteRightUndeclared: 'sequenceDiagram\n  participant P0 as A\n  participant P1 as B\n  P0-->>P1: x\n  Note right of P1: calls — not in the map',
  }
  const out = {}
  for (const [k, src] of Object.entries(cases)) {
    try { await m.render('tid_'+k, src); out[k] = 'ok' }
    catch (e) { out[k] = 'FAIL: ' + String(e && e.message).replace(/\s+/g,' ').slice(0,160) }
  }
  return out
})
console.log(JSON.stringify(res, null, 2))
await browser.close()
