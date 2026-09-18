import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DATA_DIR } from './config.js'

fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'jira.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS oauth_token (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,
  scope         TEXT,
  obtained_at   INTEGER
);

CREATE TABLE IF NOT EXISTS sites (
  cloud_id TEXT PRIMARY KEY,
  name     TEXT,
  url      TEXT,
  avatar   TEXT,
  scopes   TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  cloud_id  TEXT NOT NULL,
  id        TEXT NOT NULL,
  key       TEXT,
  name      TEXT,
  type_key  TEXT,        -- software | service_desk | business | product_discovery
  style     TEXT,        -- classic | next-gen
  avatar    TEXT,
  category  TEXT,
  lead      TEXT,
  PRIMARY KEY (cloud_id, id)
);

CREATE TABLE IF NOT EXISTS issue_types (
  cloud_id        TEXT NOT NULL,
  id              TEXT NOT NULL,
  name            TEXT,
  subtask         INTEGER,
  hierarchy_level INTEGER,   -- -1 subtask, 0 story, 1 epic, 2+ initiative/theme
  icon            TEXT,
  PRIMARY KEY (cloud_id, id)
);

CREATE TABLE IF NOT EXISTS statuses (
  cloud_id      TEXT NOT NULL,
  id            TEXT NOT NULL,
  name          TEXT,
  category_key  TEXT,   -- new | indeterminate | done
  category_name TEXT,
  PRIMARY KEY (cloud_id, id)
);

CREATE TABLE IF NOT EXISTS fields (
  cloud_id    TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT,
  custom      INTEGER,
  schema_type TEXT,
  PRIMARY KEY (cloud_id, id)
);

CREATE TABLE IF NOT EXISTS issues (
  cloud_id          TEXT NOT NULL,
  id                TEXT NOT NULL,
  key               TEXT,
  project_id        TEXT,
  project_key       TEXT,
  type_id           TEXT,
  type_name         TEXT,
  hierarchy_level   INTEGER,
  status_id         TEXT,
  status_name       TEXT,
  status_category   TEXT,
  resolution        TEXT,
  priority          TEXT,
  parent_id         TEXT,
  parent_key        TEXT,
  assignee_id       TEXT,
  assignee_name     TEXT,
  assignee_avatar   TEXT,
  reporter_id       TEXT,
  reporter_name     TEXT,
  summary           TEXT,
  labels            TEXT,   -- JSON array
  components        TEXT,   -- JSON array
  story_points      REAL,
  time_spent        INTEGER,
  original_estimate INTEGER,
  created           TEXT,
  updated           TEXT,
  resolved          TEXT,
  status_changed    TEXT,
  PRIMARY KEY (cloud_id, id)
);
CREATE INDEX IF NOT EXISTS idx_issues_parent   ON issues (cloud_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_issues_project  ON issues (cloud_id, project_id);
CREATE INDEX IF NOT EXISTS idx_issues_level    ON issues (cloud_id, hierarchy_level);
CREATE INDEX IF NOT EXISTS idx_issues_key      ON issues (cloud_id, key);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues (cloud_id, assignee_id);

CREATE TABLE IF NOT EXISTS issue_links (
  cloud_id  TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type      TEXT NOT NULL,
  direction TEXT NOT NULL,   -- outward | inward
  PRIMARY KEY (cloud_id, source_id, target_id, type, direction)
);
CREATE INDEX IF NOT EXISTS idx_links_source ON issue_links (cloud_id, source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON issue_links (cloud_id, target_id);

CREATE TABLE IF NOT EXISTS status_history (
  cloud_id    TEXT NOT NULL,
  issue_id    TEXT NOT NULL,
  at          TEXT NOT NULL,
  from_id     TEXT,
  from_status TEXT,
  to_id       TEXT,
  to_status   TEXT,
  author_id   TEXT,
  author_name TEXT,
  PRIMARY KEY (cloud_id, issue_id, at, to_id)
);
CREATE INDEX IF NOT EXISTS idx_hist_issue ON status_history (cloud_id, issue_id, at);

CREATE TABLE IF NOT EXISTS assignee_history (
  cloud_id    TEXT NOT NULL,
  issue_id    TEXT NOT NULL,
  at          TEXT NOT NULL,
  from_id     TEXT,
  from_name   TEXT,
  to_id       TEXT,
  to_name     TEXT,
  PRIMARY KEY (cloud_id, issue_id, at)
);
CREATE INDEX IF NOT EXISTS idx_ahist_issue ON assignee_history (cloud_id, issue_id, at);

-- Which issues we have already pulled a changelog for, so a refresh only
-- re-reads issues whose "updated" moved past the recorded watermark.
CREATE TABLE IF NOT EXISTS changelog_cursor (
  cloud_id     TEXT NOT NULL,
  issue_id     TEXT NOT NULL,
  issue_updated TEXT,
  fetched_at   INTEGER,
  PRIMARY KEY (cloud_id, issue_id)
);

CREATE TABLE IF NOT EXISTS dashboards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT,                         -- set only for seeded system pages
  layout     TEXT NOT NULL DEFAULT '[]',   -- JSON [{i,type,title,x,y,w,h,options}]
  created_at INTEGER,
  updated_at INTEGER
);

-- Weekly status reporting -------------------------------------------------

CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  archived   INTEGER DEFAULT 0
);

-- A reportable workstream: optionally tied to a Jira issue (initiative/epic).
CREATE TABLE IF NOT EXISTS initiatives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  jira_key   TEXT,
  archived   INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS initiative_teams (
  initiative_id INTEGER NOT NULL,
  team_id       INTEGER NOT NULL,
  PRIMARY KEY (initiative_id, team_id)
);

CREATE TABLE IF NOT EXISTS status_reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week       TEXT NOT NULL UNIQUE,   -- Monday, YYYY-MM-DD
  created_at INTEGER
);

-- One update per (team, workstream) per week; target date and the team's own
-- epic link are snapshotted here so week-over-week changes stay visible.
CREATE TABLE IF NOT EXISTS report_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     INTEGER NOT NULL,
  team_id       INTEGER,                  -- NULL = general section
  initiative_id INTEGER NOT NULL,
  jira_key      TEXT,                     -- this team's epic for the workstream
  rag           TEXT DEFAULT 'on-track',  -- on-track | at-risk | off-track | done | paused
  update_text   TEXT DEFAULT '',
  target_date   TEXT,
  sort_order    INTEGER DEFAULT 0,
  UNIQUE (report_id, team_id, initiative_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id    TEXT,
  started_at  INTEGER,
  finished_at INTEGER,
  mode        TEXT,     -- full | incremental
  status      TEXT,     -- running | ok | error | cancelled
  stats       TEXT,     -- JSON
  error       TEXT
);
`)

// No migration framework: guard column additions so existing databases catch up.
if (!db.prepare(`PRAGMA table_info(dashboards)`).all().some((c) => c.name === 'slug')) {
  db.exec('ALTER TABLE dashboards ADD COLUMN slug TEXT')
}
if (!db.prepare(`PRAGMA table_info(dashboards)`).all().some((c) => c.name === 'scope')) {
  db.exec('ALTER TABLE dashboards ADD COLUMN scope TEXT') // per-page filter, JSON
}
if (!db.prepare(`PRAGMA table_info(issues)`).all().some((c) => c.name === 'custom_fields')) {
  db.exec('ALTER TABLE issues ADD COLUMN custom_fields TEXT') // tracked extras, JSON {label: value}
}
if (!db.prepare(`PRAGMA table_info(dashboards)`).all().some((c) => c.name === 'sort_order')) {
  db.exec('ALTER TABLE dashboards ADD COLUMN sort_order INTEGER DEFAULT 0') // nav order for custom pages
}

// report_entries v1 had UNIQUE(report_id, initiative_id) and no team column;
// SQLite cannot drop a constraint, so rebuild the table once.
if (!db.prepare(`PRAGMA table_info(report_entries)`).all().some((c) => c.name === 'team_id')) {
  db.exec(`
    CREATE TABLE report_entries_v2 (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id     INTEGER NOT NULL,
      team_id       INTEGER,
      initiative_id INTEGER NOT NULL,
      jira_key      TEXT,
      rag           TEXT DEFAULT 'on-track',
      update_text   TEXT DEFAULT '',
      target_date   TEXT,
      sort_order    INTEGER DEFAULT 0,
      UNIQUE (report_id, team_id, initiative_id)
    );
    INSERT INTO report_entries_v2 (id, report_id, initiative_id, rag, update_text, target_date, sort_order)
      SELECT id, report_id, initiative_id, rag, update_text, target_date, sort_order FROM report_entries;
    DROP TABLE report_entries;
    ALTER TABLE report_entries_v2 RENAME TO report_entries;
  `)
}

// Starter teams, inserted only into an empty table.
if (!db.prepare('SELECT COUNT(*) AS n FROM teams').get().n) {
  const insert = db.prepare('INSERT INTO teams (name, sort_order) VALUES (?, ?)')
  ;['Trade Services', 'Prime', 'Portfolio', 'Ledger', 'Corporate Actions', 'Assets'].forEach(
    (name, i) => insert.run(name, i)
  )
}

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
