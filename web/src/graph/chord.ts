import type { GraphData, GraphNode } from '../lib/api'
import { collapseToServices, isDerived, type Relation } from './collapse'

/**
 * The chord layout, by hand.
 *
 * It is one page of trigonometry and the repository has six runtime
 * dependencies; d3-chord is the reference implementation and this is the same
 * arithmetic, with the theme tokens applied directly rather than bent back
 * afterwards. Everything here is pure: given the same graph it returns the same
 * numbers, which is the property the map has promised since Phase 5.
 *
 * What it draws is the same relation the map's Services view draws — an event
 * through a topic, a call through an endpoint, a shared store — so the two
 * cannot disagree about what a connection is.
 */

export type ChordArc = {
  id: string
  name: string
  teamId: string | null
  teamName: string | null
  kind: GraphNode['kind']
  /** Total traffic at this end, out and in together. */
  total: number
  out: number
  in: number
  a0: number
  a1: number
}

export type ChordRibbon = {
  id: string
  from: string
  to: string
  relation: Relation
  /** How many topics, endpoints or stores carry it. */
  weight: number
  through: { id: string; kind: string }[]
  /** The sub-arc on the source, and the one on the target. */
  s0: number
  s1: number
  t0: number
  t1: number
}

export type ChordLayout = { arcs: ChordArc[]; ribbons: ChordRibbon[]; total: number }

/** A whole turn, less the gaps between arcs. */
const TAU = Math.PI * 2
const GAP = 0.022

/**
 * Arcs in team order, then by name.
 *
 * Not by traffic: an arc that moves when a filter changes takes its ribbons
 * with it and the picture has to be re-read from scratch, and putting a team's
 * services side by side is what makes a cross-team bundle visible as a bundle.
 */
export function chordLayout(data: GraphData, hidden: Set<string> = new Set()): ChordLayout {
  const collapsed = collapseToServices(data)
  const arcNodes = collapsed.nodes
    .filter((n) => n.kind === 'service' || n.kind === 'external')
    .sort(
      (a, b) =>
        (a.teamName ?? a.teamId ?? '￿').localeCompare(b.teamName ?? b.teamId ?? '￿') ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    )
  const index = new Map(arcNodes.map((n, i) => [n.id, i]))

  type Link = { from: number; to: number; relation: Relation; weight: number; through: ChordRibbon['through'] }
  const links: Link[] = []
  for (const e of collapsed.edges) {
    if (!isDerived(e) || hidden.has(e.relation)) continue
    const from = index.get(e.from)
    const to = index.get(e.to)
    if (from === undefined || to === undefined || from === to) continue
    // An external's edge carries nothing through it — there was nothing to
    // collapse — so it counts as one.
    links.push({ from, to, relation: e.relation, weight: Math.max(1, e.through.length), through: e.through })
  }

  const out = arcNodes.map(() => 0)
  const into = arcNodes.map(() => 0)
  for (const l of links) {
    out[l.from] += l.weight
    into[l.to] += l.weight
  }

  /* An arc's length is everything that happens at it, sent and received
     together. d3's default sizes a group by its outgoing row alone, which
     gives a service nothing but callers no arc at all — and on an estate map
     "who does everybody depend on" is the question, so that is the one thing
     the picture may not drop. */
  const total = links.reduce((n, l) => n + l.weight * 2, 0)
  const present = arcNodes.filter((_, i) => out[i] + into[i] > 0).length
  const scale = total > 0 ? (TAU - Math.max(present, 1) * GAP) / total : 0

  const arcs: ChordArc[] = []
  // Where each (from, to) pair sits inside its two arcs, filled as the arcs are
  // walked so a ribbon can be given both ends at once afterwards.
  const outSlice = new Map<string, [number, number]>()
  const inSlice = new Map<string, [number, number]>()

  let cursor = 0
  arcNodes.forEach((n, i) => {
    const weight = out[i] + into[i]
    // A service nothing connects to has no arc. It is on the map, which is
    // where an island belongs; a zero-length arc here would be a label
    // attached to nothing.
    if (!weight) return
    const a0 = cursor
    const a1 = a0 + weight * scale
    let sub = a0
    // Outgoing first, then incoming, both in arc order — so the same pair is
    // always found at the same place and two readings of one picture agree.
    for (const l of links.filter((x) => x.from === i).sort((a, b) => a.to - b.to || a.relation.localeCompare(b.relation))) {
      outSlice.set(`${l.from}|${l.to}|${l.relation}`, [sub, sub + l.weight * scale])
      sub += l.weight * scale
    }
    for (const l of links.filter((x) => x.to === i).sort((a, b) => a.from - b.from || a.relation.localeCompare(b.relation))) {
      inSlice.set(`${l.from}|${l.to}|${l.relation}`, [sub, sub + l.weight * scale])
      sub += l.weight * scale
    }
    arcs.push({
      id: n.id,
      name: n.name,
      teamId: n.teamId ?? null,
      teamName: n.teamName ?? null,
      kind: n.kind,
      total: weight,
      out: out[i],
      in: into[i],
      a0,
      a1,
    })
    cursor = a1 + GAP
  })

  const ribbons: ChordRibbon[] = []
  for (const l of links) {
    const key = `${l.from}|${l.to}|${l.relation}`
    const s = outSlice.get(key)
    const t = inSlice.get(key)
    if (!s || !t) continue
    ribbons.push({
      id: key,
      from: arcNodes[l.from].id,
      to: arcNodes[l.to].id,
      relation: l.relation,
      weight: l.weight,
      through: l.through,
      s0: s[0],
      s1: s[1],
      t0: t[0],
      t1: t[1],
    })
  }

  return { arcs, ribbons, total }
}

/* ─────────────────────────────────────────────────────────────── geometry

   Angles run clockwise from twelve o'clock, which is how a reader follows a
   circle and how every label below is rotated.
*/

export const point = (r: number, a: number) => ({ x: r * Math.sin(a), y: -r * Math.cos(a) })

/** The band an arc is drawn as: an outer sweep, an inner sweep back. */
export function arcPath(inner: number, outer: number, a0: number, a1: number) {
  const big = a1 - a0 > Math.PI ? 1 : 0
  const o0 = point(outer, a0)
  const o1 = point(outer, a1)
  const i1 = point(inner, a1)
  const i0 = point(inner, a0)
  return (
    `M${o0.x} ${o0.y}` +
    `A${outer} ${outer} 0 ${big} 1 ${o1.x} ${o1.y}` +
    `L${i1.x} ${i1.y}` +
    `A${inner} ${inner} 0 ${big} 0 ${i0.x} ${i0.y}` +
    'Z'
  )
}

/**
 * A ribbon: the source sub-arc, a curve through the middle to the target
 * sub-arc, and a curve back. The control point is the centre, which is what
 * bundles the ribbons rather than letting them cut straight across.
 */
export function ribbonPath(r: number, s0: number, s1: number, t0: number, t1: number) {
  const sBig = s1 - s0 > Math.PI ? 1 : 0
  const tBig = t1 - t0 > Math.PI ? 1 : 0
  const sa = point(r, s0)
  const sb = point(r, s1)
  const ta = point(r, t0)
  const tb = point(r, t1)
  return (
    `M${sa.x} ${sa.y}` +
    `A${r} ${r} 0 ${sBig} 1 ${sb.x} ${sb.y}` +
    `Q0 0 ${ta.x} ${ta.y}` +
    `A${r} ${r} 0 ${tBig} 1 ${tb.x} ${tb.y}` +
    `Q0 0 ${sa.x} ${sa.y}` +
    'Z'
  )
}
