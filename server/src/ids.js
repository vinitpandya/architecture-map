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
