import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type Department, type GraphNode, type Team } from '../lib/api'
import { useQuery, useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'
import { TeamEditor } from '../components/TeamEditor'
import { nodeHref, teamHref } from '../lib/nodes'
import { assignTeam } from '../lib/teams'
import { full } from '../lib/format'

/**
 * Who is responsible, grouped by department. A team the registry does not have
 * is marked here rather than only in Health, because this is the page somebody
 * opens when they want to know who owns what — and "that is not a real team,
 * it is a typo" is the most useful thing this page can tell them.
 */
export function TeamsPage() {
  const { data } = useQuery<{
    configured: boolean
    problems: { kind: string; id?: string; detail: string }[]
    departments: Department[]
    teams: Team[]
  }>('/teams')
  const { status, reload } = useScope()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Team | null>(null)
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
            Copy <code>teams.example.json</code> to <code>teams.json</code>, or press Edit on any
            team below and save — both give each team a canonical id, a display name and a
            department. Until there is one, nothing can tell a new team from a misspelt one, which
            is why none of them is reported below.
          </p>
        </Card>
      )}

      {(data.problems ?? []).length > 0 && (
        <Card
          title={`${data.problems.length} ${data.problems.length === 1 ? 'problem' : 'problems'} in teams.json`}
          sub="The registry exists to catch naming drift, and it cannot catch it in its own contents"
        >
          <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.problems.map((p, i) => (
              <li key={`${i}:${p.kind}`}>{p.detail}</li>
            ))}
          </ul>
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
              <span key={t.id} className="pill">
                <Link to={teamHref(t.id)}>{t.name}</Link>
                <span className="muted" style={{ fontSize: 11 }}>
                  {t.source === 'process' ? 'a pack names it' : 'a manifest names it'}
                </span>
                <button type="button" className="ghost" onClick={() => setEditing(t)}>
                  Name it
                </button>
              </span>
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
              <TeamGrid teams={teams} storageKey={`teams-${id || 'none'}`} onEdit={setEditing} />
            </Card>
          )
        })
      )}

      {data.teams.length > 0 && <ServicesCard teams={data.teams} />}

      {editing && (
        <TeamEditor
          team={editing}
          teams={data.teams}
          departments={data.departments}
          configured={data.configured}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null)
            // Everything downstream of a team is derived from the registry —
            // the map's colours, the filter row, every handoff's cross_team —
            // so this is a reload of the whole app's data, not of one card.
            reload()
            if (id !== editing.id) navigate(teamHref(id))
          }}
        />
      )}
    </div>
  )
}

/**
 * Which service belongs to whom, in one place.
 *
 * This is the screen for the morning after a forty-repo scan, when every team
 * is a person's name and half the services guessed wrong. A change here is an
 * `overrides` row, which ingest never reads or writes — the same separation
 * that lets a node's description survive a re-scan.
 */
function ServicesCard({ teams }: { teams: Team[] }) {
  const { data } = useQuery<{ nodes: GraphNode[] }>('/nodes', { kinds: 'service', limit: '1000' })
  const { reload } = useScope()
  const [busy, setBusy] = useState<string | null>(null)
  const services = data?.nodes ?? []

  const set = async (node: GraphNode, team: string | null) => {
    setBusy(node.id)
    try {
      await assignTeam(node.id, team)
      reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title={`Services and their teams (${services.length})`}
      sub="A team set here outranks the manifest, and a re-scan cannot undo it"
    >
      {!services.length ? (
        <Empty title="No services yet" />
      ) : (
        <DataGrid
          rows={services}
          rowKey={(n) => n.id}
          storageKey="services-teams"
          maxHeight={520}
          columns={[
            {
              key: 'name',
              label: 'Service',
              wide: true,
              value: (n) => n.name,
              render: (n) => <Link to={nodeHref(n.id)}>{n.name}</Link>,
            },
            {
              key: 'repo',
              label: 'Repo',
              value: (n) => n.ownerRepo ?? '',
              render: (n) => (n.ownerRepo ? <code>{n.ownerRepo}</code> : <span className="muted">—</span>),
            },
            {
              key: 'team',
              label: 'Team',
              // Sorts and groups on the resolved team, which is what you would
              // want to group by: every service of one team together.
              value: (n) => n.teamName ?? n.teamId ?? '',
              render: (n) => (
                <select
                  aria-label={`Team for ${n.name}`}
                  disabled={busy === n.id}
                  value={n.teamId ?? ''}
                  onChange={(e) => void set(n, e.target.value ? teams.find((t) => t.id === e.target.value)!.name : '')}
                >
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ),
            },
            {
              key: 'via',
              label: 'From',
              value: (n) => n.teamVia ?? '',
              render: (n) =>
                n.teamVia === 'override' ? (
                  <span className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                    <span className="pill">corrected</span>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy === n.id}
                      onClick={() => void set(n, null)}
                    >
                      Revert to the scan
                    </button>
                  </span>
                ) : n.teamVia === 'scan' ? (
                  <span className="muted" title="service.team in the manifest">the manifest</span>
                ) : (
                  <span className="muted">—</span>
                ),
            },
          ]}
        />
      )}
    </Card>
  )
}

function TeamGrid({
  teams,
  storageKey,
  onEdit,
}: {
  teams: Team[]
  storageKey: string
  onEdit: (team: Team) => void
}) {
  return (
    <DataGrid
      rows={teams}
      rowKey={(t) => t.id}
      // One key per department: two grids sharing a key share their sort.
      storageKey={storageKey}
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
              {t.aliases.length > 0 && (
                <span className="pill" title={`Also: ${t.aliases.join(', ')}`}>
                  +{t.aliases.length}
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
        {
          key: 'edit',
          label: '',
          sortable: false,
          groupable: false,
          value: () => '',
          render: (t) => (
            <button type="button" className="ghost" onClick={() => onEdit(t)}>
              Edit
            </button>
          ),
        },
      ]}
    />
  )
}
