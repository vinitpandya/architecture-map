import { Link } from 'react-router-dom'
import type { Handoff } from '../lib/api'
import { displayCode, idValue, nodeHref, processHref, teamHref } from '../lib/nodes'

/**
 * Handoffs as a list rather than a table, because the interesting part of each
 * one is a sentence: who, to whom, over what, and whether the code agrees with
 * the document.
 *
 * `side` says which end is the other one, so the same component serves a
 * process page's "out" and "in" and a team page's both directions.
 */
export function HandoffList({
  title,
  handoffs,
  side,
}: {
  title?: string
  handoffs: Handoff[]
  /** Which end to lead with: the one that is NOT the subject. */
  side: 'to' | 'from' | 'both'
}) {
  if (!handoffs.length) return null
  return (
    <div className="stack" style={{ gap: 6 }}>
      {title && (
        <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {title}
        </div>
      )}
      <ul className="handoff-list">
        {handoffs.map((h) => (
          <li key={h.id} className={h.support === 'none' ? 'unsupported' : undefined}>
            <div className="handoff-line">
              {side === 'both' ? (
                <>
                  <End end={h.from} />
                  <span className="proc-arrow"> → </span>
                  <End end={h.to} />
                </>
              ) : (
                <End end={side === 'to' ? h.to : h.from} />
              )}
              <Badge h={h} />
            </div>
            <div className="handoff-why muted">
              {h.viaNode ? (
                <>
                  over <Link to={nodeHref(h.viaNode)}>{idValue(h.viaNode)}</Link>
                </>
              ) : (
                'no message or call carries it'
              )}
              {h.note && <> · {h.note}</>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function End({ end }: { end: Handoff['from'] }) {
  return (
    <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
      <Link to={processHref(end.code)} className="proc-code">
        {displayCode(end.code)}
      </Link>
      <Link to={processHref(end.code)}>{end.name}</Link>
      {end.teamId && (
        <Link to={teamHref(end.teamId)} className="pill">
          {end.teamName ?? end.teamId}
        </Link>
      )}
    </span>
  )
}

/**
 * The whole point of keeping derived and declared apart, in one badge. Agreed
 * is the good case and says least; a claim with nothing behind it says most,
 * because the person reading the page is the person who can fix it.
 */
function Badge({ h }: { h: Handoff }) {
  if (h.derived && h.declared)
    return (
      <span className="pill good" title="The code does this and a pack says so">
        agreed
      </span>
    )
  if (h.derived)
    return (
      <span className="pill" title="Derived from the topology; no pack mentions it">
        undocumented
      </span>
    )
  if (h.support === 'none')
    return (
      <span className="pill bad" title="Declared, and the two processes share no component at all">
        nothing behind it
      </span>
    )
  return (
    <span className="pill" title="Declared, and the two processes touch the same component">
      declared
    </span>
  )
}
