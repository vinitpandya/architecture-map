import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { PORT, ROOT, DATA_DIR, INBOX_DIR } from './config.js'
import { processIdentityChanged } from './db.js'
import { seedSystemPages } from './pageTemplates.js'
import { reconcileProcesses } from './processes.js'
import { router } from './routes.js'

fs.mkdirSync(INBOX_DIR, { recursive: true })
fs.mkdirSync(path.join(INBOX_DIR, 'quarantine'), { recursive: true })
fs.mkdirSync(path.join(INBOX_DIR, 'ingested'), { recursive: true })

seedSystemPages()

/* A process is identified by its pack and its code now, not by its code alone.
   The table was dropped on the way past db.js because its primary key and its
   uniqueness both changed; this puts it back from the pack bodies, which have
   every process any pack ever declared — including the ones an estate-wide
   number line was quietly overwriting. */
if (processIdentityChanged) {
  const { packs, processes } = reconcileProcesses()
  console.log(
    `\n  process codes are now per pack — replayed ${packs} pack(s) into ${processes} processes`
  )
}

const app = express()
app.use(express.json({ limit: '16mb' })) // manifests carry evidence snippets

app.use('/api', router)

// Serve the production build when it exists; in dev, Vite serves the UI and
// proxies /api here.
const dist = path.join(ROOT, 'web', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: String(err.message || err) })
})

app.listen(PORT, () => {
  console.log(`\n  architecture-map server  http://localhost:${PORT}`)
  console.log(`  data                     ${DATA_DIR}`)
  console.log(`  inbox                    ${INBOX_DIR}`)
  if (!fs.existsSync(dist)) console.log(`  ui (dev)                 http://localhost:5173\n`)
})
