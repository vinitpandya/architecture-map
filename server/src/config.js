import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..', '..')

export const PORT = Number(process.env.PORT || 8787)
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, 'data')

export const REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`

export const SCOPES =
  process.env.JIRA_SCOPES || 'read:jira-work read:jira-user offline_access'

// Credentials may come from .env or from the Settings page (stored in app_config).
export const ENV_CLIENT_ID = process.env.JIRA_CLIENT_ID || ''
export const ENV_CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET || ''

export const AUTH_BASE = 'https://auth.atlassian.com'
export const API_BASE = 'https://api.atlassian.com'

// The web dev server; used to bounce the browser back after the OAuth callback.
export const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173'
