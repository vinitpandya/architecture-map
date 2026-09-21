import fs from 'node:fs'
import path from 'node:path'
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
 * The registry is the only hand-authored file the server writes back, so it
 * writes it carefully: through a temporary file in the same directory and an
 * atomic rename, so an interrupted write cannot leave a half a registry, and
 * with every key it did not recognise carried through untouched. Somebody
 * hand-editing `teams.json` and somebody renaming a team on the Teams page are
 * editing the same file, and neither may silently drop the other's work.
 */
export function writeRegistry(reg) {
  const dir = path.dirname(TEAMS_FILE)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.teams.${process.pid}.json`)
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, TEAMS_FILE)
}

/**
 * The registry as an editor needs it, or a reason it cannot be edited.
 *
 * A file that exists and is not readable JSON is the one case that must never
 * be written: the edit would be applied to `{}` and everything in the file
 * would be lost. Absent is fine — an edit is how a deployment gets its first
 * registry, which is the same way `teams.example.json` says to get one.
 */
export function editableRegistry() {
  if (!registryConfigured()) return { reg: { departments: [], teams: [] } }
  const reg = readRegistry()
  if (!reg) {
    return {
      error:
        'teams.json exists and is not readable JSON. Fix or remove it first — writing to it now ' +
        'would replace whatever it contains.',
    }
  }
  // `departments` and `teams` present but not arrays is the same hazard one
  // level down: the link pass ignores them, so coercing to [] here would write
  // an empty registry over whatever somebody meant by that.
  for (const key of ['departments', 'teams']) {
    if (reg[key] !== undefined && !Array.isArray(reg[key])) {
      return { error: `teams.json has a "${key}" that is not a list. Fix it first — writing to it now would replace it.` }
    }
  }
  return { reg: { ...reg, departments: reg.departments ?? [], teams: reg.teams ?? [] } }
}

/** Every spelling that means something else, `alias id → canonical team id`. */
export const aliasMap = () =>
  new Map(db.prepare('SELECT alias, team_id FROM team_aliases').all().map((r) => [r.alias, r.team_id]))

/**
 * A raw team string as it should be joined on: normalised, then resolved
 * through the registry's aliases. Everything that reads a team *out of the
 * data* — a manifest's `service.team`, a pack's `owner`, a human's override —
 * goes through this rather than through `teamId()` directly, or a merge would
 * hold on the Teams page and nowhere else.
 *
 * Takes the map rather than reading it per call: the link pass asks this
 * question once per node.
 */
export const canonicalTeam = (raw, aliases) => {
  const id = teamId(raw)
  if (!id) return ''
  return aliases.get(id) ?? id
}

/**
 * Rebuilds `departments` and `teams` from the registry, then adds a row for
 * every team the ingested data mentions that the registry does not have.
 *
 * Those extra rows are the point. A team nobody registered still gets a name
 * and a page; it is simply marked `registered = 0`, which is what the
 * unknown-team finding reports. Dropping it instead would leave the component
 * showing a bare id with nowhere to click.
 */
/**
 * What is wrong with the registry file itself.
 *
 * The registry exists to catch naming drift, and it could not catch it in its
 * own contents: two entries normalising to one id collapsed silently, last
 * writer winning, and a misspelt `department` quietly became no department at
 * all. These are operator problems with a file rather than the estate
 * disagreeing with itself, so they are not `drift` — they are served beside the
 * teams, on the page where somebody would fix them.
 */
const problems = []

export const registryProblems = () => [...problems]

export const rebuildTeams = db.transaction(() => {
  const reg = readRegistry() ?? {}
  problems.length = 0
  if (registryConfigured() && !readRegistry()) {
    problems.push({
      kind: 'unreadable',
      detail: 'teams.json is not readable JSON, so no team is registered. The map works without it.',
    })
  }

  db.prepare('DELETE FROM team_aliases').run()
  db.prepare('DELETE FROM teams').run()
  db.prepare('DELETE FROM departments').run()

  const dept = db.prepare(
    'INSERT OR REPLACE INTO departments (id, name, description) VALUES (?, ?, ?)'
  )
  const seenDept = new Set()
  for (const d of Array.isArray(reg.departments) ? reg.departments : []) {
    const id = teamId(d?.id)
    if (!id) {
      problems.push({ kind: 'no-id', detail: `A department entry has no usable id: ${JSON.stringify(d)}` })
      continue
    }
    if (seenDept.has(id)) {
      problems.push({
        kind: 'duplicate-department',
        id,
        detail: `Two department entries both mean "${id}". The later one wins and the earlier is lost.`,
      })
    }
    seenDept.add(id)
    dept.run(id, String(d.name ?? d.id), d.description ?? null)
  }

  const known = new Set(db.prepare('SELECT id FROM departments').all().map((r) => r.id))
  const team = db.prepare(
    `INSERT OR REPLACE INTO teams (id, name, department_id, description, contact, registered, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const entries = Array.isArray(reg.teams) ? reg.teams : []

  /* ---- aliases: one spelling meaning another team.

     Validated before any team row is written, because an alias is only legal
     against the full set of declared ids: an alias that is itself a team
     entry is the registry contradicting itself, and the entry wins. First
     claim wins for the same alias twice, unlike a duplicate *entry* where the
     later wins — an entry is a statement about one team and the last edit is
     the current one, while a second team claiming somebody else's alias is a
     team taking what it was not given. */
  const declared = new Set(entries.map((t) => teamId(t?.id)).filter(Boolean))
  const aliasOf = new Map()
  for (const t of entries) {
    const id = teamId(t?.id)
    if (!id) continue
    for (const raw of Array.isArray(t.aliases) ? t.aliases : []) {
      const alias = teamId(raw)
      // An entry aliasing its own id is a no-op, not a mistake: a rename that
      // keeps the id would otherwise produce one every time.
      if (!alias || alias === id) continue
      if (declared.has(alias)) {
        problems.push({
          kind: 'alias-is-a-team',
          id,
          detail: `${String(t.name ?? id)} claims "${raw}" as an alias, and there is also a team ` +
            `entry for it. The entry wins and the alias is ignored — merge them, or drop one.`,
        })
        continue
      }
      const held = aliasOf.get(alias)
      if (held && held !== id) {
        problems.push({
          kind: 'duplicate-alias',
          id,
          detail: `Both "${held}" and "${id}" claim "${raw}" as an alias. It stays with "${held}", ` +
            `so everything spelt that way is counted under a team you may not have meant.`,
        })
        continue
      }
      aliasOf.set(alias, id)
    }
  }

  const seenTeam = new Set()
  for (const t of entries) {
    const id = teamId(t?.id)
    if (!id) {
      problems.push({ kind: 'no-id', detail: `A team entry has no usable id: ${JSON.stringify(t)}` })
      continue
    }
    // `teamId()` is what collapses them, which is the whole point of it — but
    // two entries meaning one team is a mistake in the file, not a merge the
    // author asked for.
    if (seenTeam.has(id)) {
      problems.push({
        kind: 'duplicate-team',
        id,
        detail: `Two team entries both mean "${id}". The later one wins and the earlier is lost, ` +
          `so whichever name, department and contact you are reading may not be the one you edited.`,
      })
    }
    seenTeam.add(id)

    const dep = teamId(t.department)
    if (dep && !known.has(dep)) {
      problems.push({
        kind: 'unknown-department',
        id,
        detail: `${String(t.name ?? id)} names the department "${t.department}", and no department ` +
          `entry declares it. The team is listed under no department instead.`,
      })
    }
    team.run(id, String(t.name ?? t.id), dep && known.has(dep) ? dep : null, t.description ?? null, t.contact ?? null, 1, 'registry')
  }

  const alias = db.prepare('INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)')
  for (const [from, to] of aliasOf) if (seenTeam.has(to)) alias.run(from, to)

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
      const direct = teamId(raw)
      if (!direct) continue
      // Through the aliases: a spelling that was merged away must not come
      // back as an unregistered team of its own the moment it is scanned
      // again, which is exactly when somebody would have to merge it twice.
      const id = aliasOf.get(direct) ?? direct
      // The raw string is the display name only for a team the registry does
      // not have. An aliased one is registered by definition and has a name.
      add.run(id, id === direct ? String(raw).trim() : id, source)
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
