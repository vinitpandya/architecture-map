process.env.DATA_DIR = '.scratch/data5'
const fs = await import('node:fs')
const { db } = await import('/home/user/architecture-map/server/src/db.js')
const { ingestManifest } = await import('/home/user/architecture-map/server/src/ingest.js')
const { ingestProcessPack } = await import('/home/user/architecture-map/server/src/processes.js')

// H: pack FIRST, manifests after — the pack must resolve once the topology lands
const packJson = JSON.parse(fs.readFileSync('.scratch/demo/processes/order-and-execution.json','utf8'))
ingestProcessPack(packJson, 'order-and-execution.json')
console.log('H: leaves with edge_id BEFORE manifests:', db.prepare('SELECT COUNT(*) n FROM processes WHERE edge_id IS NOT NULL').get().n)
console.log('H: process_components BEFORE manifests:', db.prepare('SELECT COUNT(*) n FROM process_components').get().n)
for (const f of fs.readdirSync('.scratch/demo/manifests')) ingestManifest(JSON.parse(fs.readFileSync('.scratch/demo/manifests/'+f,'utf8')), f)
console.log('H: leaves with edge_id AFTER manifests:', db.prepare('SELECT COUNT(*) n FROM processes WHERE edge_id IS NOT NULL').get().n)
console.log('H: process_components AFTER manifests:', db.prepare('SELECT COUNT(*) n FROM process_components').get().n)

// A-variant: missing node_id suppresses a genuine missing-interaction
const call = { from: 'svc:reporting-service', kind: 'http.call', to: 'api:wallet-service/GET /v1/wallets/{}/balance' }
ingestProcessPack({schemaVersion:1,pack:'v',name:'v',authoredAt:'2026-09-18T00:00:00Z',producer:{kind:'human'},processes:[
  {code:'8',name:'root'},
  {code:'8.1',name:'ghost node plus a real-ends call', node:'svc:ghost', interaction: call},
]}, 'v.json')
console.log('A-variant findings:', db.prepare("SELECT kind, subject_id FROM drift WHERE subject_id LIKE 'proc:8%'").all())

// E: orphan-coded process with components — does a phantom parent land in process_components?
ingestProcessPack({schemaVersion:1,pack:'w',name:'w',authoredAt:'2026-09-18T00:00:00Z',producer:{kind:'human'},processes:[
  {code:'9.4.1',name:'orphan with a component', node:'svc:order-service'},
]}, 'w.json')
console.log('E: phantom join rows:', db.prepare(`SELECT * FROM process_components WHERE process_id NOT IN (SELECT id FROM processes)`).all())
console.log('E: phantom edge rows:', db.prepare(`SELECT * FROM process_edges WHERE process_id NOT IN (SELECT id FROM processes)`).all())
