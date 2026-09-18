import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..', '..')

export const PORT = Number(process.env.PORT || 8787)

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, 'data')

/** Where scan manifests are dropped for ingest. */
export const INBOX_DIR = process.env.INBOX_DIR
  ? path.resolve(ROOT, process.env.INBOX_DIR)
  : path.join(ROOT, 'inbox')

export const SCHEMA_FILE = path.join(ROOT, 'schema', 'manifest.schema.json')

/** The web dev server, for CORS-free local development. */
export const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173'
