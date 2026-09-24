import crypto from 'node:crypto'

/* ──────────────────────────────────────────────── the derived ids

   One hashing rule, one place — SPEC-PROCESSES §12.8. It lives in a module of
   its own rather than in ingest.js because link.js needs it too, and ingest.js
   already imports link.js: a second hashing call site would have been the
   price of avoiding a cycle, and a second hashing call site is exactly what
   that invariant exists to prevent.
*/

/** The one hashing primitive. Every derived id in the estate comes through it. */
export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

/**
 * An edge's identity is the triple it connects, so the same relationship found
 * by two scans, or written in a different order, is the same row — which is
 * what lets `first_seen` mean anything.
 */
export const edgeId = (from, kind, to) => sha1(`${from}|${kind}|${to}`)

/**
 * A handoff's identity is four parts, not three: one pair of processes can
 * legitimately hand off over two different topics, and those are two facts.
 */
export const linkId = (from, kind, to, viaNode) => sha1(`${from}|${kind}|${to}|${viaNode ?? ''}`)

/* ──────────────────────────────────────────────── a process's identity

   Here rather than in processes.js for exactly the reason above: link.js
   needs every one of these, and processes.js already imports link.js.

   A process is its PACK and its code together. The code carries the hierarchy
   — the number of segments is the level, the parent is the code minus its last
   segment — and the pack carries whose hierarchy it is. A code alone was the
   identity once, which made it one estate-wide number line that every pack had
   to be numbered against; packs authored independently all began at 1, and the
   last one ingested silently took every code the others had claimed.
*/

/** `L2.1.1` and `2.1.1` are the same process. The prefix is display, not data. */
export const normaliseCode = (code) => String(code ?? '').trim().replace(/^[Ll]/, '')

/**
 * `proc:onboarding:2.1.1`. Neither a pack id (`^[a-z0-9][a-z0-9._-]*$`) nor a
 * code can contain a colon, so the three parts split back out unambiguously —
 * which packOf and codeOf rely on.
 */
export const processId = (pack, code) => `proc:${pack}:${normaliseCode(code)}`

export const packOf = (id) => String(id ?? '').split(':')[1] ?? null
export const codeOf = (id) => String(id ?? '').split(':')[2] ?? null

/** How a process is written for a reader: `onboarding L2.1.1`. */
export const refOf = (pack, code) => `${pack} L${normaliseCode(code)}`

export const levelOf = (code) => normaliseCode(code).split('.').length

/** `2.1.1` → `proc:<pack>:2.1`; null at level 1, which has no parent. */
export function parentIdOf(pack, code) {
  const parts = normaliseCode(code).split('.')
  return parts.length > 1 ? processId(pack, parts.slice(0, -1).join('.')) : null
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

/**
 * A reference from one process to another, as `handsOffTo` and `next` write
 * it: a bare code means the pack it was written in, and `<pack>#<code>` means
 * somebody else's. Same-pack is the overwhelming case and stays the short
 * form, because a team writing its own flow should not have to name itself.
 */
export function resolveRef(ref, fromPack) {
  const raw = String(ref ?? '').trim()
  if (!raw) return null
  const hash = raw.indexOf('#')
  return hash === -1
    ? processId(fromPack, raw)
    : processId(raw.slice(0, hash).trim(), raw.slice(hash + 1))
}
