import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DATA_DIR } from './config.js'

fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'architecture.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ───────────────────────────────────────────────────────────── ingest log

CREATE TABLE IF NOT EXISTS manifests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo            TEXT NOT NULL,
  commit_sha      TEXT,
  branch          TEXT,
  scanned_at      TEXT,
  ingested_at     TEXT NOT NULL,
  schema_version  INTEGER,
  prompt_version  TEXT,
  producer_kind   TEXT,           -- claude | parser | human
  producer_detail TEXT,
  service_id      TEXT,
  source_file     TEXT,
  status          TEXT NOT NULL,  -- active | superseded | quarantined
  raw             TEXT NOT NULL,
  errors          TEXT            -- ajv errors as JSON, when quarantined
);
CREATE INDEX IF NOT EXISTS manifests_repo ON manifests (repo, status);

-- ─────────────────────────────────────────────────────────────── layer A

CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  engine        TEXT,
  method        TEXT,
  path          TEXT,
  contract_type TEXT,
  language      TEXT,
  team          TEXT,
  owner_repo    TEXT,
  orphan        INTEGER NOT NULL DEFAULT 0,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS nodes_kind ON nodes (kind);

CREATE TABLE IF NOT EXISTS node_sources (
  node_id     TEXT NOT NULL,
  manifest_id INTEGER NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  repo        TEXT NOT NULL,
  PRIMARY KEY (node_id, manifest_id)
);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,            -- sha1(from|kind|to)
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  contract_id TEXT,
  description TEXT,
  confidence  TEXT NOT NULL,
  repo        TEXT NOT NULL,
  manifest_id INTEGER NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edges_from ON edges (from_id);
CREATE INDEX IF NOT EXISTS edges_to   ON edges (to_id);
CREATE INDEX IF NOT EXISTS edges_kind ON edges (kind);

CREATE TABLE IF NOT EXISTS evidence (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind TEXT NOT NULL,   -- node | edge | unresolved
  subject_id   TEXT NOT NULL,
  repo         TEXT NOT NULL,
  file         TEXT NOT NULL,
  line         INTEGER NOT NULL,
  end_line     INTEGER,
  snippet      TEXT NOT NULL,
  manifest_id  INTEGER NOT NULL REFERENCES manifests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS evidence_subject ON evidence (subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS unresolved (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo        TEXT NOT NULL,
  expected    TEXT NOT NULL,
  raw         TEXT NOT NULL,
  reason      TEXT,
  manifest_id INTEGER NOT NULL REFERENCES manifests(id) ON DELETE CASCADE
);

-- Version binding is per service, never global: two services legitimately bind
-- different versions of one contract, and that divergence is the finding.
CREATE TABLE IF NOT EXISTS contract_bindings (
  contract_id TEXT NOT NULL,
  service_id  TEXT NOT NULL,
  version     TEXT,
  manifest_id INTEGER NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  PRIMARY KEY (contract_id, service_id)
);

-- ───────────────────────────────────────────────────────────── findings

CREATE TABLE IF NOT EXISTS drift (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  subject_id  TEXT,
  severity    TEXT NOT NULL,   -- info | warn
  detail      TEXT NOT NULL,
  data        TEXT,
  detected_at TEXT NOT NULL
);

-- ───────────────────────────────────── human corrections (ingest never touches)

CREATE TABLE IF NOT EXISTS overrides (
  subject_kind TEXT NOT NULL,   -- node | edge
  subject_id   TEXT NOT NULL,
  field        TEXT NOT NULL,   -- description | name | team | hidden | confirmed
  value        TEXT,
  author       TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (subject_kind, subject_id, field)
);

-- ─────────────────────────────────────── layer B (created now, unused in v1)

CREATE TABLE IF NOT EXISTS processes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT UNIQUE NOT NULL,
  level       INTEGER NOT NULL,
  parent_id   INTEGER REFERENCES processes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS process_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id  INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  node_id     TEXT,
  edge_id     TEXT
);

-- ───────────────────────────────────────────────────────────────── pages

CREATE TABLE IF NOT EXISTS dashboards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT,                         -- set only for seeded system pages
  layout     TEXT NOT NULL DEFAULT '[]',   -- JSON [{i,type,title,x,y,w,h,options}]
  scope      TEXT,                         -- per-page filter row, JSON
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

-- ───────────────────────────────────────────────────────────────── search

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  subject_kind UNINDEXED,
  subject_id   UNINDEXED,
  title,
  body,
  repo         UNINDEXED,
  tokenize = 'porter unicode61'
);
`)

export function getConfig(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return row.value
  }
}

export function setConfig(key, value) {
  db.prepare(
    'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}

export function deleteConfig(key) {
  db.prepare('DELETE FROM app_config WHERE key = ?').run(key)
}

/** True once at least one manifest has been ingested successfully. */
export function hasData() {
  return db.prepare(`SELECT COUNT(*) AS n FROM manifests WHERE status = 'active'`).get().n > 0
}
