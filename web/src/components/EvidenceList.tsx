import type { Evidence } from '../lib/api'
import { Empty } from './ui'

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
}: {
  evidence: Evidence[]
  empty?: string
}) {
  if (!evidence.length) {
    return <Empty title="No citation of its own">
      <span className="muted" style={{ fontSize: 12 }}>{empty}</span>
    </Empty>
  }

  return (
    <ul className="evidence-list">
      {evidence.map((e) => (
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
}
