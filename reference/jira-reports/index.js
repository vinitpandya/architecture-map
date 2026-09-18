import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { PORT, ROOT, DATA_DIR } from './config.js'
import './db.js'
import { seedSystemPages } from './pageTemplates.js'
import { router } from './routes.js'

seedSystemPages()

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

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
  console.log(`\n  jira-reports server  http://localhost:${PORT}`)
  console.log(`  data                 ${DATA_DIR}`)
  if (!fs.existsSync(dist)) console.log(`  ui (dev)             http://localhost:5173\n`)
})
