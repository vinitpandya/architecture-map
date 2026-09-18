process.env.DATA_DIR = '.scratch/data4'
const fs = await import('node:fs')
const { db } = await import('/home/user/architecture-map/server/src/db.js')
const { ingestManifest } = await import('/home/user/architecture-map/server/src/ingest.js')
const { ingestProcessPack } = await import('/home/user/architecture-map/server/src/processes.js')
for (const f of fs.readdirSync('demo/manifests')) ingestManifest(JSON.parse(fs.readFileSync('demo/manifests/'+f,'utf8')), f)

const call = { from: 'svc:reporting-service', kind: 'http.call', to: 'api:wallet-service/GET /v1/wallets/{}/balance' }
const pack = (processes) => ({ schemaVersion:1, pack:'dr', name:'dr', authoredAt:'2026-09-18T00:00:00Z', producer:{kind:'human'}, processes })

// control: the interaction alone, both ends real, the call is not in the code
ingestProcessPack(pack([{ code:'8', name:'root' }, { code:'8.1', name:'call not in code', node:'svc:reporting-service', interaction: call }]), 'dr.json')
console.log('CONTROL findings:', db.prepare("SELECT kind, subject_id FROM drift WHERE subject_id LIKE 'proc:8%'").all())

// same process, plus one unrelated bogus `touches`
ingestProcessPack(pack([{ code:'8', name:'root' }, { code:'8.1', name:'call not in code', node:'svc:reporting-service', interaction: call, touches:['topic:gone.v1'] }]), 'dr.json')
console.log('WITH BOGUS TOUCHES:', db.prepare("SELECT kind, subject_id FROM drift WHERE subject_id LIKE 'proc:8%'").all())
