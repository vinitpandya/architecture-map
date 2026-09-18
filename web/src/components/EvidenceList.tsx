import type { Evidence } from '../lib/api'
import { Empty } from './ui'

/**
 * Where a fact is visible in the source. Every node and edge carries at least
 * one of these — that requirement is what makes the map checkable rather than
 * decorative, so the citation is shown, not hidden behind a disclosure.
 */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) {
    return <Empty title="No evidence recorded">
      <span className="muted" style={{ fontSize: 12 }}>
        Nothing should reach this state — every fact is meant to cite its source.
      </span>
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
