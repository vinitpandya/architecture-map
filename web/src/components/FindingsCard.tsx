import type { DriftFinding } from '../lib/api'
import { driftTitle } from '../lib/drift'
import { Highlight, ListSearch, MatchedIn, NoMatch, textOf, useSearch, valuesOf } from './SearchBox'
import { Card } from './ui'

/**
 * What a finding is found by: what kind it is, what it says, who it is about
 * and routed to, what somebody wrote when accepting it, and every party it
 * names — the values in `data`, never its keys, or "repo" would match them all.
 */
export const findingText = (f: DriftFinding) =>
  textOf(
    driftTitle(f.kind),
    f.kind,
    f.detail,
    f.subject_id,
    f.team_id,
    f.state === 'accepted' && 'accepted',
    f.state_note,
    ...valuesOf(f.data)
  )

/** What a finding's row does not show but its search reads: who it is about and routed to, and who it names. */
export const findingHidden = (f: DriftFinding): [string, string | null][] => [
  ['About', f.subject_id],
  ['Routed to', f.team_id],
  ['Accepted because', f.state_note],
  ...valuesOf(f.data).map((v) => ['Names', v] as [string, string]),
]

/** The findings about one node or one process, on its own page. */
export function FindingsCard({ drift, sub }: { drift: DriftFinding[]; sub: string }) {
  const search = useSearch(drift, findingText)
  if (!drift.length) return null
  return (
    <Card title={`Findings (${drift.length})`} sub={sub}>
      <ListSearch
        query={search.query}
        onChange={search.setQuery}
        shown={search.matches.length}
        total={drift.length}
        noun="findings"
        label="Search findings"
      />
      {search.matches.length ? (
        <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
          {search.matches.map((f) => (
            <li key={f.id}>
              <strong>
                <Highlight text={driftTitle(f.kind)} q={search.q} />
              </strong>{' '}
              — <Highlight text={f.detail} q={search.q} />
              {f.state === 'accepted' && <span className="muted"> · accepted</span>}{' '}
              <MatchedIn q={search.q} shown={[driftTitle(f.kind), f.detail, f.state === 'accepted' && 'accepted']} hidden={findingHidden(f)} />
            </li>
          ))}
        </ul>
      ) : (
        <NoMatch query={search.query} />
      )}
    </Card>
  )
}
