import { useMemo, useState } from 'react'
import type { GraphData } from '../lib/api'
import { useMeasure } from '../components/ui'
import { KIND_COLOR, NO_TEAM_COLOR } from '../lib/nodes'
import { RELATION_COLOR, RELATION_LABEL } from './collapse'
import { arcPath, chordLayout, point, ribbonPath } from './chordLayout'

/**
 * Who talks to whom, as a circle.
 *
 * The map answers "what is connected to what" and does it badly at scale — a
 * service estate is a hairball, and past a few dozen nodes the lines are the
 * only thing you can see. A chord trades the topology away entirely and keeps
 * one fact: how much of each service's traffic goes where. The arcs are
 * ordered by team, so a bundle crossing the circle is a bundle crossing a team
 * boundary.
 *
 * Drawn from the same three relationships the map's Services view collapses
 * to, so the two cannot disagree about what a connection is.
 */

/** Past this many services the labels come off; the arcs stay. */
const LABEL_BUDGET = 44

export function Chord({
  data,
  height,
  colourBy,
  teamSlot,
  hiddenRelations,
  selected,
  onSelect,
}: {
  data: GraphData
  height: number
  colourBy: 'kind' | 'team'
  teamSlot: Map<string, string>
  /** What the key has switched off, so the circle obeys it like the map does. */
  hiddenRelations: Set<string>
  selected: string | null
  onSelect: (id: string) => void
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const layout = useMemo(() => chordLayout(data, hiddenRelations), [data, hiddenRelations])

  const size = Math.max(180, Math.min(width || 0, height) - 24)
  // The ring, less whatever the labels need outside it.
  const outer = size / 2 - (layout.arcs.length <= LABEL_BUDGET ? 104 : 16)
  const inner = Math.max(12, outer - 11)

  // The arc the reader is asking about: whatever the mouse is over, else
  // whatever is selected. Hover wins, because it is the faster question.
  const lit = hover ?? selected
  const near = useMemo(() => {
    if (!lit) return null
    const set = new Set([lit])
    for (const r of layout.ribbons) {
      if (r.from === lit) set.add(r.to)
      if (r.to === lit) set.add(r.from)
    }
    return set
  }, [lit, layout.ribbons])

  /* Every arc is a service or an external, so Kind mode has one answer for
     almost all of them — which is fine, and still the honest one: the arcs
     wear the same colour those nodes wear on the map. The ribbons are what
     carry the encoding here, and the key lists them. */
  const arcColour = (a: (typeof layout.arcs)[number]) =>
    colourBy === 'team'
      ? `var(${(a.teamId && teamSlot.get(a.teamId)) || NO_TEAM_COLOR})`
      : `var(${KIND_COLOR[a.kind]})`

  if (!layout.arcs.length) {
    return (
      <div ref={ref} className="chord-empty" style={{ height }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Nothing here talks to anything else. Either one service has been scanned, the filter row
          has narrowed the map to a set with no connections inside it, or the key has every kind of
          line switched off.
        </p>
      </div>
    )
  }

  const focused = lit ? layout.arcs.find((a) => a.id === lit) : null
  const hovered = hover ? layout.ribbons.find((r) => r.id === hover) : null

  return (
    <div ref={ref} className="chord" style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
        role="img"
        aria-label={`${layout.arcs.length} services and the traffic between them`}
      >
        <g className="chord-ribbons">
          {layout.ribbons.map((r) => {
            const direct = !lit || r.from === lit || r.to === lit
            return (
              <path
                key={r.id}
                d={ribbonPath(inner, r.s0, r.s1, r.t0, r.t1)}
                fill={`var(${RELATION_COLOR[r.relation]})`}
                fillOpacity={lit && !direct ? 0.05 : lit ? 0.62 : 0.32}
                // Outlined in the surface, not in its own colour: a dozen
                // ribbons overlap in the middle and without a gap between them
                // they read as one shape.
                stroke="var(--surface-1)"
                strokeOpacity={lit && !direct ? 0 : 0.85}
                strokeWidth={0.9}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${nameOf(layout, r.from)} → ${nameOf(layout, r.to)} · ${RELATION_LABEL[r.relation].toLowerCase()}`}</title>
              </path>
            )
          })}
        </g>

        <g className="chord-arcs">
          {layout.arcs.map((a) => {
            const on = !near || near.has(a.id)
            const mid = (a.a0 + a.a1) / 2
            const label = point(outer + 8, mid)
            const turn = (mid * 180) / Math.PI
            const flip = mid > Math.PI
            return (
              <g
                key={a.id}
                opacity={on ? 1 : 0.22}
                // On the group, so the label counts as part of the arc: an arc
                // is eleven pixels thick and the name beside it is the thing
                // anybody actually aims at.
                onMouseEnter={() => setHover(a.id)}
                onMouseLeave={() => setHover(null)}
              >
                <path
                  d={arcPath(inner, outer, a.a0, a.a1)}
                  fill={arcColour(a)}
                  fillOpacity={a.id === selected ? 1 : 0.78}
                  className="chord-arc"
                  onClick={() => onSelect(a.id)}
                >
                  <title>{`${a.name} · ${a.out} out, ${a.in} in`}</title>
                </path>
                {layout.arcs.length <= LABEL_BUDGET && (
                  <text
                    className="chord-label"
                    x={label.x}
                    y={label.y}
                    // Rotated onto the radius and flipped on the left-hand side,
                    // so no label is ever upside down.
                    transform={`rotate(${turn - 90} ${label.x} ${label.y}) ${flip ? `rotate(180 ${label.x} ${label.y})` : ''}`}
                    textAnchor={flip ? 'end' : 'start'}
                    dominantBaseline="middle"
                    onClick={() => onSelect(a.id)}
                  >
                    {a.name.length > 26 ? `${a.name.slice(0, 25)}…` : a.name}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      <p className="chord-note muted">
        {hovered ? (
          <>
            <strong>{nameOf(layout, hovered.from)}</strong> → <strong>{nameOf(layout, hovered.to)}</strong> ·{' '}
            {RELATION_LABEL[hovered.relation].toLowerCase()} through{' '}
            {hovered.through.length ? hovered.through.map((t) => idOnly(t.id)).join(', ') : 'a direct call'}
          </>
        ) : focused ? (
          <>
            <strong>{focused.name}</strong> — {focused.out} out, {focused.in} in. Click it to open it
            in the inspector, or hover a ribbon for what carries it.
          </>
        ) : (
          <>
            An arc is everything that happens at one service, sent and received together, and the
            arcs are ordered by team — a bundle crossing the circle crosses a boundary. Hover a
            ribbon to see which way it goes and what carries it.
            {layout.arcs.length > LABEL_BUDGET && ` Labels are off above ${LABEL_BUDGET} services.`}
          </>
        )}
      </p>
    </div>
  )
}

const nameOf = (layout: ReturnType<typeof chordLayout>, id: string) =>
  layout.arcs.find((a) => a.id === id)?.name ?? id

const idOnly = (id: string) => id.slice(id.indexOf(':') + 1)
