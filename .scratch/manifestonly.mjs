process.env.DATA_DIR = '.scratch/data2'
const fs = await import('node:fs')
const { db } = await import('/home/user/architecture-map/server/src/db.js')
const { ingestManifest } = await import('/home/user/architecture-map/server/src/ingest.js')
for (const f of fs.readdirSync('demo/manifests')) {
  ingestManifest(JSON.parse(fs.readFileSync('demo/manifests/' + f, 'utf8')), f)
}
console.log('drift by kind:', db.prepare('SELECT kind, COUNT(*) n FROM drift GROUP BY kind').all())
console.log('processes:', db.prepare('SELECT COUNT(*) n FROM processes').get().n, 'packs:', db.prepare('SELECT COUNT(*) n FROM process_packs').get().n)
