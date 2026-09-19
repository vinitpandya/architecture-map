import fs from 'node:fs'
import { TEAMS_FILE } from './config.js'
import { db } from './db.js'

/* ────────────────────────────────────────────────────── the id

   One normalisation rule, one place. It fixes case and separators and it does
   not guess: `Trading` and `trading` are one team, `Trading Team` is another.
   A normaliser clever enough to merge those two would be a normaliser that
   silently merges two real teams whose names happen to be similar, and the
   registry — not a heuristic — is what says one was meant to be the other.
*/

export const teamId = (raw) =>
  String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

/* ────────────────────────────────────────────────────── the registry

   `teams.json` is a file the repository owns, not something that arrives
   through the inbox: no manifest, no quarantine, no supersession. It is read
   on every link pass, and its absence is a supported state rather than an
   error — the app works without it and says `configured: false`, exactly as
   it does for `repos.json`.
*/

/** The file as it is on disk, or null when there isn't one (or it is broken). */
export function readRegistry() {
  if (!fs.existsSync(TEAMS_FILE)) return null
  try {
    const json = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'))
    return json && typeof json === 'object' ? json : null
  } catch {
    // Malformed is the same as absent: say so through `configured` and carry
    // on with derived teams rather than refusing to serve the estate.
    return null
  }
}

export const registryConfigured = () => fs.existsSync(TEAMS_FILE)

/**
 * Rebuilds `departments` and `teams` from the registry, then adds a row for
 * every team the ingested data mentions that the registry does not have.
 *
 * Those extra rows are the point. A team nobody registered still gets a name
 * and a page; it is simply marked `registered = 0`, which is what the
 * unknown-team finding reports. Dropping it instead would leave the component
 * showing a bare id with nowhere to click.
 */
export const rebuildTeams = db.transaction(() => {
  const reg = readRegistry() ?? {}

  db.prepare('DELETE FROM teams').run()
  db.prepare('DELETE FROM departments').run()

  const dept = db.prepare(
    'INSERT OR REPLACE INTO departments (id, name, description) VALUES (?, ?, ?)'
  )
  for (const d of Array.isArray(reg.departments) ? reg.departments : []) {
    const id = teamId(d?.id)
    if (!id) continue
    dept.run(id, String(d.name ?? d.id), d.description ?? null)
  }

  const known = new Set(db.prepare('SELECT id FROM departments').all().map((r) => r.id))
  const team = db.prepare(
    `INSERT OR REPLACE INTO teams (id, name, department_id, description, contact, registered, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const t of Array.isArray(reg.teams) ? reg.teams : []) {
    const id = teamId(t?.id)
    if (!id) continue
    const dep = teamId(t.department)
    team.run(id, String(t.name ?? t.id), dep && known.has(dep) ? dep : null, t.description ?? null, t.contact ?? null, 1, 'registry')
  }

  // Everything the data mentions, whether or not the registry knows it. The
  // raw string is kept as the display name, because "Risk Ops" reads better
  // than "risk-ops" and it is what somebody actually wrote.
  //
  // `source` records the most authoritative thing that produced the id, so
  // /teams can distinguish a team that owns services from one that is named in
  // a document and owns nothing. A pack bringing a team into existence is the
  // same shape as a pack bringing a component into existence, which
  // SPEC-PROCESSES §12.1 forbids — it is allowed here because a team is an
  // attribute rather than a member of the estate, but it should say so.
  const add = db.prepare(
    `INSERT INTO teams (id, name, registered, source) VALUES (?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       source = CASE WHEN teams.source = 'process' AND excluded.source = 'component'
                     THEN 'component' ELSE teams.source END`
  )
  for (const [sql, source] of [
    [`SELECT team AS raw FROM nodes WHERE team IS NOT NULL AND TRIM(team) <> ''`, 'component'],
    [`SELECT owner AS raw FROM processes WHERE owner IS NOT NULL AND TRIM(owner) <> ''`, 'process'],
  ]) {
    for (const { raw } of db.prepare(sql).all()) {
      const id = teamId(raw)
      if (id) add.run(id, String(raw).trim(), source)
    }
  }
})

/** `{id, name, department, registered}` for every team, for display. */
export const teamMap = () =>
  new Map(
    db
      .prepare(
        `SELECT t.id, t.name, t.description, t.contact, t.registered, t.source,
                t.department_id AS departmentId, d.name AS departmentName
         FROM teams t LEFT JOIN departments d ON d.id = t.department_id
         ORDER BY t.id`
      )
      .all()
      .map((r) => [r.id, { ...r, registered: !!r.registered }])
  )
