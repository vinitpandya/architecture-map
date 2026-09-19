import { Link } from 'react-router-dom'
import { type Department, type Team } from '../lib/api'
import { useQuery, useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'
import { teamHref } from '../lib/nodes'
import { full } from '../lib/format'

/**
 * Who is responsible, grouped by department. A team the registry does not have
 * is marked here rather than only in Health, because this is the page somebody
 * opens when they want to know who owns what — and "that is not a real team,
 * it is a typo" is the most useful thing this page can tell them.
 */
export function TeamsPage() {
  const { data } = useQuery<{ configured: boolean; departments: Department[]; teams: Team[] }>('/teams')
  const { status } = useScope()
  if (!data) return null

  const unregistered = data.teams.filter((t) => !t.registered)
  const byDepartment = new Map<string, Team[]>()
  for (const t of data.teams) {
    const key = t.department?.id ?? ''
    if (!byDepartment.has(key)) byDepartment.set(key, [])
    byDepartment.get(key)!.push(t)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p>
            {data.teams.length
              ? `${data.teams.length} teams across ${data.departments.length || 'no'} ${
                  data.departments.length === 1 ? 'department' : 'departments'
                }, accounting for ${full(status?.handoffs.crossTeam ?? 0)} handoffs that cross a boundary.`
              : 'Nothing has been ingested, so there is nobody to be responsible for it yet.'}
          </p>
        </div>
      </div>

      {!data.configured && data.teams.length > 0 && (
        <Card
          title="No teams.json"
          sub="These teams are whatever the manifests and the packs happen to say"
        >
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Copy <code>teams.example.json</code> to <code>teams.json</code> to give each team a
            canonical id, a display name and a department. Until then nothing can tell a new team
            from a misspelt one, which is why none of them is reported below.
          </p>
        </Card>
      )}

      {data.configured && unregistered.length > 0 && (
        <Card
          title={`${unregistered.length} ${unregistered.length === 1 ? 'team is' : 'teams are'} not in the registry`}
          sub="Named by a manifest or a pack, and absent from teams.json"
        >
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Either the team was renamed or merged and the documents have not followed, or the
            registry is behind. Both are worth an answer before anybody trusts a team count.
          </p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {unregistered.map((t) => (
              <Link key={t.id} to={teamHref(t.id)} className="pill">
                {t.name}
                <span className="muted" style={{ fontSize: 11 }}>
                  {t.source === 'process' ? 'a pack names it' : 'a manifest names it'}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {!data.teams.length ? (
        <Empty title="No teams yet">
          <span className="muted" style={{ fontSize: 13 }}>
            A team arrives with the data: <code>service.team</code> in a manifest, or{' '}
            <code>owner</code> on a process. Run <code>npm run seed:demo</code> for the sample
            estate.
          </span>
        </Empty>
      ) : (
        [...byDepartment.entries()].map(([id, teams]) => {
          const dept = data.departments.find((d) => d.id === id)
          return (
            <Card
              key={id || 'none'}
              title={dept?.name ?? 'No department'}
              sub={dept?.description ?? (id ? undefined : 'Not in the registry, so not placed anywhere')}
            >
              <TeamGrid teams={teams} />
            </Card>
          )
        })
      )}
    </div>
  )
}

function TeamGrid({ teams }: { teams: Team[] }) {
  return (
    <DataGrid
      rows={teams}
      rowKey={(t) => t.id}
      storageKey="teams"
      columns={[
        {
          key: 'name',
          label: 'Team',
          wide: true,
          value: (t) => t.name,
          render: (t) => (
            <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
              <Link to={teamHref(t.id)}>{t.name}</Link>
              {!t.registered && (
                <span className="pill bad" title="Not in teams.json">
                  unregistered
                </span>
              )}
            </span>
          ),
        },
        {
          key: 'components',
          label: 'Components',
          value: (t) => t.components,
          // A team named only by a pack owns nothing, and saying "0" leaves the
          // reader to work out why. This is the case teams.json exists for.
          render: (t) =>
            t.components ? (
              <>{full(t.components)}</>
            ) : (
              <span className="muted" title="Named in a document; owns nothing the scan found">
                none
              </span>
            ),
        },
        { key: 'processes', label: 'Processes', value: (t) => t.processes },
        {
          key: 'out',
          label: 'Hands off to',
          value: (t) => t.handoffsOut,
          render: (t) => (t.handoffsOut ? <>{full(t.handoffsOut)}</> : <span className="muted">—</span>),
        },
        {
          key: 'in',
          label: 'Hands off from',
          value: (t) => t.handoffsIn,
          render: (t) => (t.handoffsIn ? <>{full(t.handoffsIn)}</> : <span className="muted">—</span>),
        },
        {
          key: 'contact',
          label: 'Contact',
          value: (t) => t.contact ?? '',
          render: (t) => (t.contact ? <code>{t.contact}</code> : <span className="muted">—</span>),
        },
      ]}
    />
  )
}
