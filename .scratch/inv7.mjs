process.env.DATA_DIR = '.scratch/data'
const crypto = await import('node:crypto')
const { db } = await import('/home/user/architecture-map/server/src/db.js')
const { linkPass } = await import('/home/user/architecture-map/server/src/link.js')
const { ingestProcessPack } = await import('/home/user/architecture-map/server/src/processes.js')
const fs = await import('node:fs')
const h = (sql) => crypto.createHash('sha1').update(JSON.stringify(db.prepare(sql).all())).digest('hex')
const snap = () => ({ n: db.prepare('SELECT COUNT(*) n FROM nodes').get().n, e: db.prepare('SELECT COUNT(*) n FROM edges').get().n, nh: h('SELECT * FROM nodes ORDER BY id'), eh: h('SELECT * FROM edges ORDER BY id'), ev: db.prepare('SELECT COUNT(*) n FROM evidence').get().n })

// 1. authored rollup row must be destroyed by the link pass
db.prepare("INSERT OR REPLACE INTO process_components (process_id, node_id, via) VALUES ('proc:2.1.1','ext:stripe','node')").run()
db.prepare("INSERT OR REPLACE INTO process_edges (process_id, edge_id, via) VALUES ('proc:2.1.1','deadbeef','interaction')").run()
const before = snap()
linkPass()
console.log('authored component survived link pass?', !!db.prepare("SELECT 1 FROM process_components WHERE process_id='proc:2.1.1' AND node_id='ext:stripe'").get())
console.log('authored edge survived link pass?', !!db.prepare("SELECT 1 FROM process_edges WHERE edge_id='deadbeef'").get())

// 2. overrides survive a pack ingest
db.prepare("INSERT OR REPLACE INTO overrides (subject_kind,subject_id,field,value,author,updated_at) VALUES ('node','svc:order-service','description','HUMAN NOTE','rev','2026-01-01')").run()
const pack = JSON.parse(fs.readFileSync('demo/processes/order-and-execution.json','utf8'))
ingestProcessPack(pack, 'order-and-execution.json')
console.log('override survived pack re-ingest?', db.prepare("SELECT value FROM overrides WHERE subject_id='svc:order-service' AND field='description'").get())

// 3. re-ingesting all three packs writes nothing to nodes/edges/evidence
const b2 = snap()
for (const f of ['order-and-execution','onboarding','reporting']) ingestProcessPack(JSON.parse(fs.readFileSync(`demo/processes/${f}.json`,'utf8')), f+'.json')
const a2 = snap()
console.log('nodes/edges/evidence identical after 3 pack re-ingests:', b2.nh===a2.nh && b2.eh===a2.eh && b2.ev===a2.ev, JSON.stringify(b2), JSON.stringify(a2))
