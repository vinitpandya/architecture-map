process.env.DATA_DIR = '.scratch/data'
process.env.INBOX_DIR = '.scratch/inbox'
const { db } = await import('/home/user/architecture-map/server/src/db.js')
const crypto = await import('node:crypto')
const h = (sql) => crypto.createHash('sha1').update(JSON.stringify(db.prepare(sql).all())).digest('hex')
const snap = () => ({ nodes: db.prepare('SELECT COUNT(*) n FROM nodes').get().n, edges: db.prepare('SELECT COUNT(*) n FROM edges').get().n, nh: h('SELECT * FROM nodes ORDER BY id'), eh: h('SELECT * FROM edges ORDER BY id'), procs: db.prepare('SELECT COUNT(*) n FROM processes').get().n })
const before = snap()
const { sweepInbox } = await import('/home/user/architecture-map/server/src/ingest.js')
const results = sweepInbox('.scratch/inbox')
console.log(JSON.stringify(results, null, 1).slice(0, 1400))
const after = snap()
console.log('before', JSON.stringify(before))
console.log('after ', JSON.stringify(after))
console.log('nodes/edges identical:', before.nh === after.nh && before.eh === after.eh)
