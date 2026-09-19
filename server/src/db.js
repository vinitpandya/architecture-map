import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { DATA_DIR } from './config.js'

fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'architecture.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/**
 * The original spec created `processes` and `process_steps` as placeholders
 * with an entirely different shape, and nothing ever wrote to them. Layer B
 * replaces them, so they are dropped — but only when the legacy shape is what
 * is actually there. An unconditional drop would throw away the real processes
 * on every restart.
 */
const legacy = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'processes'`)
  .get()
if (legacy && db.prepare('PRAGMA table_info(processes)').all().some((c) => c.name === 'key')) {
  db.exec('DROP TABLE IF EXISTS process_steps; DROP TABLE IF EXISTS processes;')
}
db.exec('DROP TABLE IF EXISTS process_steps;')

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

-- ─────────────────────────────────────────────── layer B: pack ingest log

CREATE TABLE IF NOT EXISTS process_packs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pack            TEXT NOT NULL,
  name            TEXT,
  description     TEXT,
  authored_at     TEXT,
  ingested_at     TEXT NOT NULL,
  schema_version  INTEGER,
  prompt_version  TEXT,
  producer_kind   TEXT,
  producer_detail TEXT,
  source          TEXT,            -- JSON, the pack-level default
  source_file     TEXT,
  status          TEXT NOT NULL,   -- active | superseded | quarantined
  raw             TEXT NOT NULL,
  errors          TEXT
);
CREATE INDEX IF NOT EXISTS process_packs_pack ON process_packs (pack, status);

-- ─────────────────── the hierarchy: one row per process, at every level.
-- There is no step table. A step IS a process: the levels are decomposition,
-- so a level 3 is already the atomic unit of work.

CREATE TABLE IF NOT EXISTS processes (
  id          TEXT PRIMARY KEY,          -- 'proc:2.1.1'
  code        TEXT NOT NULL UNIQUE,      -- '2.1.1', the L stripped
  level       INTEGER NOT NULL,          -- derived: segment count, 1-3
  parent_id   TEXT,                      -- derived: 'proc:2.1'; NULL at level 1
  sort_key    TEXT NOT NULL,             -- zero-padded; never order by code
  name        TEXT NOT NULL,
  description TEXT,
  owner       TEXT,
  actor       TEXT,
  trigger     TEXT,
  outcome     TEXT,
  node_id     TEXT,                      -- may not exist in nodes; that is a finding
  edge_id     TEXT,                      -- resolved via edgeId(); NULL when unresolved
  edge_from   TEXT,                      -- the interaction kept verbatim, so an
  edge_kind   TEXT,                      -- unresolved one is still displayable and
  edge_to     TEXT,                      -- still explains what the author meant
  optional    INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  tags        TEXT,                      -- JSON array
  source      TEXT,                      -- JSON; the pack's when the process has none
  pack_id     INTEGER NOT NULL REFERENCES process_packs(id) ON DELETE CASCADE,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS processes_parent ON processes (parent_id);
CREATE INDEX IF NOT EXISTS processes_sort   ON processes (sort_key);
CREATE INDEX IF NOT EXISTS processes_node   ON processes (node_id);

-- ───────────────────────────── the join between the layers, rebuilt whole
-- by the link pass. Derived, never authored.

CREATE TABLE IF NOT EXISTS process_components (
  process_id TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- node | interaction | touches | exposes | rollup
  PRIMARY KEY (process_id, node_id)
);
CREATE INDEX IF NOT EXISTS process_components_node ON process_components (node_id);

CREATE TABLE IF NOT EXISTS process_edges (
  process_id TEXT NOT NULL,
  edge_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- interaction | rollup
  PRIMARY KEY (process_id, edge_id)
);
CREATE INDEX IF NOT EXISTS process_edges_edge ON process_edges (edge_id);

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

-- ─────────────────────────────────────────── the org, loaded from teams.json
-- Not ingested: there is no manifest for it, no quarantine and no
-- supersession. It describes the organisation, not the code.

CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,   -- 'trading', canonical, out of teamId()
  name          TEXT NOT NULL,      -- 'Trading', for display
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  description   TEXT,
  contact       TEXT,
  -- 1 = in teams.json. 0 = seen in the data and nowhere else, which is what
  -- the unknown-team finding reports. Either way it gets a row, so every
  -- screen can name it rather than showing a bare id.
  registered    INTEGER NOT NULL DEFAULT 0,
  -- The most authoritative thing that produced this id: the registry, a
  -- component's team, or a process pack's owner. A team whose only source is a
  -- pack is named in a document and owns nothing in the estate, which /teams
  -- should say rather than listing it as though it were established.
  source        TEXT NOT NULL DEFAULT 'process'
);
CREATE INDEX IF NOT EXISTS teams_department ON teams (department_id);

-- ────────────────── handoffs between processes, derived and declared alike.
-- Rebuilt whole by the link pass, like every other join in this file.

CREATE TABLE IF NOT EXISTS process_links (
  id         TEXT PRIMARY KEY,   -- sha1(from|kind|to|via_node)
  from_id    TEXT NOT NULL,      -- 'proc:2.3.2'
  to_id      TEXT NOT NULL,      -- 'proc:3.1.2'
  kind       TEXT NOT NULL,      -- kafka | declared
  via_node   TEXT,               -- the topic that carries it; NULL when declared
  via        TEXT NOT NULL,      -- interaction | rollup
  declared   INTEGER NOT NULL DEFAULT 0,
  derived    INTEGER NOT NULL DEFAULT 0,
  -- How much the topology corroborates a declared claim: kafka (it is also
  -- derived), component (the two processes touch the same thing), or none —
  -- which is the only case worth a finding.
  support    TEXT NOT NULL,
  -- The teams of the LEAF pair that produced this row, carried unchanged into
  -- every rollup of it. A rolled-up row's own ends are ancestors, whose owners
  -- are frequently different teams from the children that perform the handoff,
  -- so reading the row's ends would attribute it to a team that never touched
  -- it — and put a pair in the team matrix that never happened.
  from_team_id TEXT,
  to_team_id   TEXT,
  cross_team INTEGER NOT NULL DEFAULT 0,
  -- The two edges the derivation matched: the publish and the consume. A
  -- derived handoff is a fact from code, so it cites the code.
  from_edge_id TEXT,
  to_edge_id   TEXT,
  note       TEXT,               -- the author's, when declared
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS process_links_from ON process_links (from_id);
CREATE INDEX IF NOT EXISTS process_links_to   ON process_links (to_id);

-- ─────────────── which teams a process reaches, and what reaches them.
-- Derived, never authored. One query per screen rather than a join per row.

CREATE TABLE IF NOT EXISTS process_teams (
  process_id TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  via        TEXT NOT NULL,   -- owner | component | handoff
  via_node   TEXT NOT NULL DEFAULT '',  -- the component that reaches it
  PRIMARY KEY (process_id, team_id, via, via_node)
);
CREATE INDEX IF NOT EXISTS process_teams_team ON process_teams (team_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  subject_kind UNINDEXED,
  subject_id   UNINDEXED,
  title,
  body,
  repo         UNINDEXED,
  tokenize = 'porter unicode61'
);
`)

/**
 * A derived column added to a table that already exists in the field. SQLite
 * has no `ADD COLUMN IF NOT EXISTS`, and this runs on every boot against
 * databases of every vintage, so the check is the migration.
 */
function addColumn(table, column, type) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

// The resolved team. `nodes.team` and `processes.owner` keep whatever the scan
// and the pack wrote, because those are the evidence; these are what joins.
addColumn('nodes', 'team_id', 'TEXT')
addColumn('processes', 'team_id', 'TEXT')
// 'owner' when the process names its own, 'inherited' when it takes the nearest
// ancestor's. A leaf inside a stage owned by trading is trading unless it says
// otherwise, which is what a reader assumes — and a teamless leaf would
// otherwise drop out of the team filter and poison cross_team on every handoff
// it takes part in.
addColumn('processes', 'team_via', 'TEXT')
db.exec(`
  CREATE INDEX IF NOT EXISTS nodes_team     ON nodes (team_id);
  CREATE INDEX IF NOT EXISTS processes_team ON processes (team_id);
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
