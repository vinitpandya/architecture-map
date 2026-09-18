const Database = require('better-sqlite3')
const crypto = require('node:crypto')
const db = new Database('/home/user/architecture-map/data/architecture.sqlite', { readonly: true })
const h = (sql) => crypto.createHash('sha1').update(JSON.stringify(db.prepare(sql).all())).digest('hex')
console.log(JSON.stringify({
  nodes: db.prepare('SELECT COUNT(*) n FROM nodes').get().n,
  edges: db.prepare('SELECT COUNT(*) n FROM edges').get().n,
  nodesHash: h('SELECT * FROM nodes ORDER BY id'),
  edgesHash: h('SELECT * FROM edges ORDER BY id'),
  evidence: db.prepare('SELECT COUNT(*) n FROM evidence').get().n,
  processes: db.prepare('SELECT COUNT(*) n FROM processes').get().n,
  packs: db.prepare('SELECT COUNT(*) n FROM process_packs').get().n,
  activePacks: db.prepare("SELECT COUNT(*) n FROM process_packs WHERE status='active'").get().n,
  pc: db.prepare('SELECT COUNT(*) n FROM process_components').get().n,
  pe: db.prepare('SELECT COUNT(*) n FROM process_edges').get().n,
  drift: db.prepare('SELECT COUNT(*) n FROM drift').get().n,
  search: db.prepare("SELECT COUNT(*) n FROM search_index").get().n,
}))
