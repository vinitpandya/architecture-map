import type { Evidence } from '../lib/api'
import { Empty } from './ui'
import { ListSearch, NoMatch, textOf, useSearch } from './SearchBox'

/**
 * Where a fact is visible in the source. Every edge carries at least one of
 * these — that requirement is what makes the map checkable rather than
 * decorative, so the citation is shown, not hidden behind a disclosure.
 *
 * A node is the exception, and a legitimate one: the manifest schema's
 * `service` block carries no `evidence`, so a service's citations are whatever
 * other repos wrote when they referenced it, and a service nobody else
 * references has none of its own. That is a gap in the schema, recorded in
 * DECISIONS.md — not a bug to accuse the tool of on four of the ten demo
 * services. `empty` says which of the two situations this is.
 */
export function EvidenceList({
  evidence,
  empty = 'Nothing cites this directly; its edges carry the evidence.',
  searchable = true,
}: {
  evidence: Evidence[]
  empty?: string
  /**
   * Off where the list sits inside one row of a list that is itself searched
   * — a finding's first three citations — rather than standing on its own.
   */
  searchable?: boolean
}) {
  // Found by where it is and by what it says: a repo, a file, a line number,
  // or the name of whatever the snippet calls.
  const search = useSearch(evidence, (e) => textOf(e.repo, `${e.file}:${e.line}`, e.snippet))
  if (!evidence.length) {
    return <Empty title="No citation of its own">
      <span className="muted" style={{ fontSize: 12 }}>{empty}</span>
    </Empty>
  }

  const list = (
    <ul className="evidence-list">
      {search.matches.map((e) => (
        <li key={e.id}>
          <div className="evidence-where muted">
            {e.repo} · {e.file}:{e.line}
            {e.end_line && e.end_line !== e.line ? `-${e.end_line}` : ''}
          </div>
          <pre className="evidence-snippet">
            <code>{e.snippet}</code>
          </pre>
        </li>
      ))}
    </ul>
  )
  if (!searchable) return list
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ListSearch
        query={search.query}
        onChange={search.setQuery}
        shown={search.matches.length}
        total={evidence.length}
        noun="citations"
        label="Search citations"
      />
      {search.matches.length ? list : <NoMatch query={search.query} />}
    </div>
  )
}
