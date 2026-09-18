import { PROCESS_SCHEMA_FILE } from './config.js'
import { db } from './db.js'
import { compileSchema, edgeId, explainErrors, labelOf, rebuildSearch } from './ingest.js'
import { linkPass } from './link.js'

/* ────────────────────────────────────────────────────── the code

   A process is identified by its code, and the code carries everything: the
   number of segments is the level, the parent is the code minus its last
   segment. There is no separate parent pointer to fall out of sync, and "does
   this code's parent exist" is therefore a checkable invariant rather than a
   hope.
*/

/** `L2.1.1` and `2.1.1` are the same process. The prefix is display, not data. */
export const normaliseCode = (code) => String(code ?? '').trim().replace(/^[Ll]/, '')

export const processId = (code) => `proc:${normaliseCode(code)}`

export const levelOf = (code) => normaliseCode(code).split('.').length

/** `2.1.1` → `proc:2.1`; null at level 1, which has no parent by construction. */
export function parentIdOf(code) {
  const parts = normaliseCode(code).split('.')
  return parts.length > 1 ? `proc:${parts.slice(0, -1).join('.')}` : null
}

/**
 * Lexically, `2.10` sorts before `2.9` and `10` before `2`. With processes this
 * granular, ten children is the common case rather than the edge case, so
 * every segment is zero-padded and everything orders by this instead.
 */
export const sortKeyOf = (code) =>
  normaliseCode(code)
    .split('.')
    .map((seg) => seg.padStart(4, '0'))
    .join('.')

/* ────────────────────────────────────────────────────── validation */

export function validateProcessPack(json) {
  const check = compileSchema(PROCESS_SCHEMA_FILE)
  return check(json) ? { ok: true, errors: null } : { ok: false, errors: explainErrors(check.errors) }
}

/* ────────────────────────────────────────────────────── ingest

   Deliberately the same shape as ingestManifest(): validate or quarantine
   whole, supersede this pack's previous contribution, upsert inside one
   transaction, then run the global passes.

   The one thing that is different is the thing that matters: this function
   never writes to `nodes` or `edges`. A pack reads topology and reports what
   it cannot find. If a pack could bring a component into existence, the estate
   would fill with things nobody has ever seen in code and Layer A's evidence
   promise would quietly stop meaning anything.
*/

export function ingestProcessPack(json, sourceFile = null) {
  const { ok, errors } = validateProcessPack(json)
  const now = new Date().toISOString()
  // Off an unvalidated body, so never assumed to be a string — see labelOf().
  const pack = labelOf(json?.pack, sourceFile)

  if (!ok) {
    db.prepare(
      `INSERT INTO process_packs (pack, ingested_at, status, raw, errors, source_file)
       VALUES (?, ?, 'quarantined', ?, ?, ?)`
    ).run(pack, now, JSON.stringify(json ?? null), JSON.stringify(errors), sourceFile)
    return { ok: false, pack, errors }
  }

  const result = upsertPack(json, sourceFile, now)

  // Global, and after every ingest of either kind: a scan manifest landing
  // tomorrow can resolve a process that does not resolve today, and must.
  linkPass(now)
  rebuildSearch()

  return result
}

/**
 * One statement, used for every pack the rebuild below replays. `first_seen`
 * is passed in rather than read here, because the row it would have been read
 * from has just been deleted.
 */
const upsertProcess = db.prepare(
  `INSERT INTO processes
     (id, code, level, parent_id, sort_key, name, description, owner, actor, trigger, outcome,
      node_id, edge_id, edge_from, edge_kind, edge_to, optional, notes, tags, source,
      pack_id, first_seen, last_seen)
   VALUES
     (@id, @code, @level, @parent_id, @sort_key, @name, @description, @owner, @actor, @trigger,
      @outcome, @node_id, @edge_id, @edge_from, @edge_kind, @edge_to, @optional, @notes, @tags,
      @source, @pack_id, @first_seen, @now)
   ON CONFLICT(id) DO UPDATE SET
     code = excluded.code, level = excluded.level, parent_id = excluded.parent_id,
     sort_key = excluded.sort_key, name = excluded.name, description = excluded.description,
     owner = excluded.owner, actor = excluded.actor, trigger = excluded.trigger,
     outcome = excluded.outcome, node_id = excluded.node_id, edge_id = excluded.edge_id,
     edge_from = excluded.edge_from, edge_kind = excluded.edge_kind, edge_to = excluded.edge_to,
     optional = excluded.optional, notes = excluded.notes, tags = excluded.tags,
     source = excluded.source, pack_id = excluded.pack_id, last_seen = excluded.last_seen`
)

const edgeExists = db.prepare('SELECT 1 FROM edges WHERE id = ?')

/**
 * Writes one pack's processes. Returns the distinct codes it actually wrote.
 * `stamp` is the pack's own `ingested_at`, so replaying a pack that nobody
 * touched does not move its `last_seen` — that field means "when this pack
 * last confirmed it", not "when the database was last written".
 */
function writeProcesses(json, packId, stamp, wasSeen) {
  const packSource = json.source ? JSON.stringify(json.source) : null
  const codes = new Set()

  for (const p of json.processes ?? []) {
    const code = normaliseCode(p.code)
    const id = processId(code)
    const i = p.interaction ?? null
    codes.add(code)

    // One hashing rule, one place: the same edgeId() the scan keyed its edges
    // with. `edge_id` is set only when that edge is actually in the topology —
    // an interaction the code does not have is a finding, not a broken join.
    const candidate = i ? edgeId(i.from, i.kind, i.to) : null

    upsertProcess.run({
      id,
      code,
      level: levelOf(code),
      parent_id: parentIdOf(code),
      sort_key: sortKeyOf(code),
      name: p.name,
      description: p.description ?? null,
      owner: p.owner ?? null,
      actor: p.actor ?? null,
      trigger: p.trigger ?? null,
      outcome: p.outcome ?? null,
      node_id: p.node ?? null,
      edge_id: candidate && edgeExists.get(candidate) ? candidate : null,
      edge_from: i?.from ?? null,
      edge_kind: i?.kind ?? null,
      edge_to: i?.to ?? null,
      optional: p.optional ? 1 : 0,
      notes: p.notes ?? null,
      tags: p.tags?.length ? JSON.stringify(p.tags) : null,
      source: p.source ? JSON.stringify(p.source) : packSource,
      pack_id: packId,
      first_seen: wasSeen.get(id) ?? stamp,
      now: stamp,
    })

    // Deliberately absent: any write to nodes or edges. See the note above.
    // A `touches` entry, a node_id or an interaction end that is not in the
    // topology stays unresolved and becomes a finding in the link pass.
  }

  return codes
}

/**
 * `processes` is a pure function of the active packs, so it is rebuilt whole
 * rather than patched — which is the only way the join can be right when two
 * packs declare one code.
 *
 * `processes.code` is unique, so a single row can hold only one of them, and
 * the upsert hands it to whichever pack wrote last. Clearing "this pack's rows"
 * on the next re-ingest would then take away a row the other pack still
 * declares, with nothing to bring it back until that pack happened to be
 * re-ingested. Replaying them all is a few hundred rows at estate scale and
 * cannot drift.
 *
 * Oldest pack first: `process_packs.id` is AUTOINCREMENT, so the pack just
 * ingested always has the largest id and is always the last writer.
 *
 * Returns the codes each pack actually wrote, keyed by pack id.
 */
export const rebuildProcesses = db.transaction(() => {
  // A process keeps its first_seen across the rebuild even though the row is
  // deleted, so "since when has this been documented" stays true.
  const wasSeen = new Map(
    db.prepare('SELECT id, first_seen FROM processes').all().map((r) => [r.id, r.first_seen])
  )

  db.prepare('DELETE FROM processes').run()

  const written = new Map()
  for (const row of db
    .prepare(`SELECT id, raw, ingested_at FROM process_packs WHERE status = 'active' ORDER BY id`)
    .all()) {
    let parsed = null
    try {
      parsed = JSON.parse(row.raw)
    } catch {
      // Stored by an earlier version of this code and no longer readable. It
      // contributes nothing rather than stopping every pack behind it.
      continue
    }
    written.set(row.id, writeProcesses(parsed, row.id, row.ingested_at, wasSeen))
  }
  return written
})

const upsertPack = db.transaction((json, sourceFile, now) => {
  const pack = json.pack
  const prior = db
    .prepare(`SELECT id FROM process_packs WHERE pack = ? AND status = 'active'`)
    .all(pack)
    .map((r) => r.id)

  if (prior.length) {
    const marks = prior.map(() => '?').join(',')
    // Superseded packs stay in the log, so the cascade never fires — the
    // derived rows go explicitly, exactly as Layer A does it.
    db.prepare(`UPDATE process_packs SET status = 'superseded' WHERE id IN (${marks})`).run(...prior)
  }

  const packId = db
    .prepare(
      `INSERT INTO process_packs
         (pack, name, description, authored_at, ingested_at, schema_version, prompt_version,
          producer_kind, producer_detail, source, source_file, status, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(
      pack,
      json.name ?? null,
      json.description ?? null,
      json.authoredAt ?? null,
      now,
      json.schemaVersion,
      json.promptVersion ?? null,
      json.producer?.kind ?? null,
      json.producer?.author ?? json.producer?.model ?? json.producer?.tool ?? null,
      json.source ? JSON.stringify(json.source) : null,
      sourceFile,
      JSON.stringify(json)
    ).lastInsertRowid

  const codes = rebuildProcesses().get(packId) ?? new Set()

  // Counted off the distinct codes, not the array: a pack that declares one
  // code twice writes one row, and the log should say so rather than repeat
  // the number the author offered.
  const levels = {}
  for (const code of codes) levels[levelOf(code)] = (levels[levelOf(code)] ?? 0) + 1

  return {
    ok: true,
    pack,
    packId,
    counts: {
      processes: codes.size,
      declared: json.processes?.length ?? 0,
      level1: levels[1] ?? 0,
      level2: levels[2] ?? 0,
      level3: levels[3] ?? 0,
    },
  }
})
