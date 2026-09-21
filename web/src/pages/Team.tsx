import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { type Department, type Handoff, type Team, type TeamDetail } from '../lib/api'
import { useQuery, useScope } from '../lib/scope'
import { TeamEditor } from '../components/TeamEditor'
import { Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'
import { KIND_LABEL, displayCode, idValue, nodeHref, processHref, teamHref } from '../lib/nodes'
import { HandoffList } from '../components/HandoffList'

/**
 * One team: what it owns, what it runs, and where its work meets everybody
 * else's. The last of those is the reason the page exists — a team can read its
 * own repositories, but nothing else can tell it which other teams depend on a
 * topic it is about to change.
 */
export function TeamPage() {
  const [params] = useSearchParams()
  const id = params.get('id') ?? ''
  const { data, error } = useQuery<TeamDetail>(id ? '/team' : null, { id })
  // The editor needs the other teams to merge into and the departments to
  // choose from, and neither is on this endpoint — /team is one team.
  const { data: all } = useQuery<{ teams: Team[]; departments: Department[]; configured: boolean }>('/teams')
  const { reload } = useScope()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)

  if (!id) return <div className="page"><Empty title="No team named" /></div>
  if (error)
    return (
      <div className="page">
        <Empty title={`No team ${id}`}>
          <span className="muted" style={{ fontSize: 13 }}>
            {error}. <Link to="/teams">All teams</Link>.
          </span>
        </Empty>
      </div>
    )
  if (!data) return null

  const { team, components, processes, handoffs, reaches } = data
  const crossing = reaches.filter((r) => r.team_id !== team.id)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link to="/teams">Teams</Link>
            {team.department && <> · {team.department.name}</>}
          </div>
          <h1>
            {team.name}
            {!team.registered && (
              <span className="pill bad" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                not in teams.json
              </span>
            )}
          </h1>
          <p>
            {team.description ??
              (team.registered
                ? 'No description in the registry.'
                : 'Named by the data rather than the registry, so there is nothing to describe it.')}
          </p>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          {team.contact && <code className="pill">{team.contact}</code>}
          <button type="button" className="ghost" onClick={() => setEditing(true)}>
            Edit team
          </button>
        </div>
      </div>

      {team.aliases.length > 0 && (
        <p className="muted" style={{ fontSize: 13, margin: '-6px 0 0' }}>
          Also answers to{' '}
          {team.aliases.map((a, i) => (
            <span key={a}>
              {i > 0 && ', '}
              <code>{a}</code>
            </span>
          ))}{' '}
          — renamed or merged, so anything in the data still spelt that way is counted here.
        </p>
      )}

      {editing && all && (
        <TeamEditor
          team={team}
          teams={all.teams}
          departments={all.departments}
          configured={all.configured}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false)
            reload()
            if (next !== team.id) navigate(teamHref(next))
          }}
        />
      )}

      {!team.registered && (
        <Card title="Where this team came from" sub="It is not in the registry">
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {team.source === 'process'
              ? 'A process pack names it as an owner, and nothing in the estate belongs to it. Either the team was renamed or merged and the document has not followed, or it is a misspelling of a team that does exist.'
              : 'A manifest names it as a service owner. Add it to teams.json to give it a department and a contact, or correct the manifest.'}
          </p>
        </Card>
      )}

      <Card
        title={`Hands off to and from other teams (${handoffs.out.length + handoffs.in.length})`}
        sub="Where this team's work ends and somebody else's begins"
      >
        {handoffs.out.length + handoffs.in.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nothing crosses a boundary in either direction. For a team that owns components this
            usually means its processes are not documented yet, rather than that it works alone.
          </p>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            {handoffs.out.length > 0 && <HandoffList title="Out" handoffs={handoffs.out} side="to" />}
            {handoffs.in.length > 0 && <HandoffList title="In" handoffs={handoffs.in} side="from" />}
          </div>
        )}
      </Card>

      {crossing.length > 0 && (
        <Card
          title={`Depends on ${crossing.length} other ${crossing.length === 1 ? 'team' : 'teams'}`}
          sub="Counted over the components this team's processes use — a call is a dependency, not a handoff"
        >
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {crossing.map((r) => (
              <Link key={r.team_id} to={teamHref(r.team_id)} className="pill">
                {r.name ?? r.team_id}
                <span className="muted" style={{ fontSize: 11 }}>
                  {r.n} {r.n === 1 ? 'component' : 'components'}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Runs ${processes.length} ${processes.length === 1 ? 'process' : 'processes'}`}>
        {processes.length ? (
          <DataGrid
            rows={processes}
            rowKey={(p) => p.id}
            storageKey={`team-processes-${team.id}`}
            columns={[
              {
                key: 'code',
                label: 'Code',
                value: (p) => p.code,
                render: (p) => <Link to={processHref(p.code)}>{displayCode(p.code)}</Link>,
              },
              {
                key: 'name',
                label: 'What happens',
                wide: true,
                value: (p) => p.name,
                render: (p) => <Link to={processHref(p.code)}>{p.name}</Link>,
              },
              { key: 'level', label: 'Level', value: (p) => p.level },
            ]}
          />
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No documented process names this team as its owner.
          </p>
        )}
      </Card>

      <Card
        title={`Owns ${components.length} ${components.length === 1 ? 'component' : 'components'}`}
        sub="Its own services, and everything they own — the databases, topics and endpoints follow"
      >
        {components.length ? (
          <DataGrid
            rows={components}
            rowKey={(c) => c.id}
            storageKey={`team-components-${team.id}`}
            columns={[
              {
                key: 'kind',
                label: 'Kind',
                value: (c) => KIND_LABEL[c.kind] ?? c.kind,
              },
              {
                key: 'name',
                label: 'Component',
                wide: true,
                value: (c) => c.name,
                render: (c) => <Link to={nodeHref(c.id)}>{c.name}</Link>,
              },
              { key: 'id', label: 'Id', value: (c) => idValue(c.id), render: (c) => <code>{idValue(c.id)}</code> },
            ]}
          />
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Nothing in the estate resolves to this team.
          </p>
        )}
      </Card>
    </div>
  )
}

export type { Handoff }
