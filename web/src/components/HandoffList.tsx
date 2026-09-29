import { Link } from 'react-router-dom'
import type { Handoff } from '../lib/api'
import { displayCode, idValue, nodeHref, processHref, teamHref } from '../lib/nodes'
import { ListSearch, MatchedIn, NoMatch, textOf, useSearch } from './SearchBox'

type Side = 'to' | 'from' | 'both'

/** What a handoff is found by: both ends, both teams, what carries it, and what the badge says. */
const handoffText = (h: Handoff) =>
  textOf(
    displayCode(h.from.code),
    h.from.code,
    h.from.name,
    h.from.pack,
    h.from.teamName,
    h.from.teamId,
    displayCode(h.to.code),
    h.to.code,
    h.to.name,
    h.to.pack,
    h.to.teamName,
    h.to.teamId,
    h.viaNode,
    h.note,
    badgeOf(h).label
  )

/**
 * The lists a screen shows together — out, in, inside — under one search,
 * because the reader is looking for a handoff, not for a section. A section
 * the search empties drops out, as an empty one always has.
 */
export function HandoffSections({ sections }: { sections: { title: string; handoffs: Handoff[]; side: Side }[] }) {
  const all = sections.flatMap((s) => s.handoffs)
  const search = useSearch(all, handoffText)
  const kept = new Set(search.matches)
  return (
    <div className="stack" style={{ gap: 14 }}>
      <ListSearch
        query={search.query}
        onChange={search.setQuery}
        shown={search.matches.length}
        total={all.length}
        noun="handoffs"
        label="Search handoffs"
      />
      {search.narrowed && !search.matches.length && <NoMatch query={search.query} />}
      {sections.map((s) => (
        <HandoffList
          key={s.title}
          title={s.title}
          handoffs={s.handoffs.filter((h) => kept.has(h))}
          side={s.side}
          q={search.q}
        />
      ))}
    </div>
  )
}

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
  q = '',
}: {
  title?: string
  handoffs: Handoff[]
  /** Which end to lead with: the one that is NOT the subject. */
  side: Side
  /** The search its section is under, for saying why a row matched. */
  q?: string
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
              {h.note && <> · {h.note}</>}{' '}
              <MatchedIn
                q={q}
                shown={[
                  ...(side === 'both' ? [h.from, h.to] : [side === 'to' ? h.to : h.from]).flatMap((e) => [
                    displayCode(e.code),
                    e.name,
                    e.teamName ?? e.teamId,
                  ]),
                  h.viaNode && idValue(h.viaNode),
                  h.note,
                  badgeOf(h).label,
                ]}
                hidden={[
                  ['From', `${displayCode(h.from.code)} ${h.from.name} · ${h.from.pack} · ${h.from.teamName ?? h.from.teamId ?? ''}`],
                  ['To', `${displayCode(h.to.code)} ${h.to.name} · ${h.to.pack} · ${h.to.teamName ?? h.to.teamId ?? ''}`],
                  ['Over', h.viaNode],
                ]}
              />
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
      <Link to={processHref(end.pack, end.code)} className="proc-code">
        {displayCode(end.code)}
      </Link>
      <Link to={processHref(end.pack, end.code)}>{end.name}</Link>
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
function badgeOf(h: Handoff): { label: string; tone: string; title: string } {
  if (h.derived && h.declared) return { label: 'agreed', tone: 'good', title: 'The code does this and a pack says so' }
  if (h.derived) return { label: 'undocumented', tone: '', title: 'Derived from the topology; no pack mentions it' }
  if (h.support === 'none')
    return { label: 'nothing behind it', tone: 'bad', title: 'Declared, and the two processes share no component at all' }
  return { label: 'declared', tone: '', title: 'Declared, and the two processes touch the same component' }
}

function Badge({ h }: { h: Handoff }) {
  const b = badgeOf(h)
  return (
    <span className={b.tone ? `pill ${b.tone}` : 'pill'} title={b.title}>
      {b.label}
    </span>
  )
}
