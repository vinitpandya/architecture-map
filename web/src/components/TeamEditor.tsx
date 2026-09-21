import { useState } from 'react'
import { api, type Department, type Team } from '../lib/api'
import { teamIdOf } from '../lib/teams'
import { Modal } from './ui'

/**
 * The registry editor.
 *
 * A scan derives a team from whatever the commit history says, so an estate
 * arrives with teams named after people and the same team spelt four ways.
 * This is where that is fixed — once, in `teams.json`, rather than repeatedly
 * in every manifest. Nothing here writes to a manifest, so the next scan
 * cannot undo any of it.
 *
 * Renaming can move the team's id, and the id is what every link, filter and
 * saved view joins on. That is stated on screen before you save rather than
 * discovered from the address bar afterwards.
 */
export function TeamEditor({
  team,
  teams,
  departments,
  configured = true,
  onClose,
  onSaved,
}: {
  team: Team
  teams: Team[]
  departments: Department[]
  /** Whether a `teams.json` exists yet. Saving is what creates the first one. */
  configured?: boolean
  onClose: () => void
  /** The id the team ended up at — it may not be the one it started with. */
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState(team.name)
  const [department, setDepartment] = useState(team.department?.name ?? '')
  const [description, setDescription] = useState(team.description ?? '')
  const [contact, setContact] = useState(team.contact ?? '')
  const [into, setInto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An id follows its name only when it came from the name in the first place.
  // A registry entry whose author deliberately called `platform` "Platform
  // Engineering" has already said the two are not the same thing.
  const derived = team.id === teamIdOf(team.name)
  const trimmed = name.trim()
  const nextId = derived && trimmed && trimmed !== team.name ? teamIdOf(trimmed) : team.id
  const clash = nextId !== team.id && teams.some((t) => t.id === nextId)
  const others = teams.filter((t) => t.id !== team.id)

  const run = async (fn: () => Promise<{ id: string }>) => {
    setBusy(true)
    setError(null)
    try {
      onSaved((await fn()).id)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit ${team.name}`} onClose={onClose}>
      <form
        className="stack"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (clash) return
          void run(() =>
            api.put<{ id: string }>('/team', {
              id: team.id,
              name: trimmed,
              department,
              description,
              contact,
            })
          )
        }}
      >
        <label className="stack" style={{ gap: 4 }}>
          <span className="nav-group-label">Name</span>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>

        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {clash ? (
            <>
              <strong>{trimmed}</strong> is already a team. Merge into it below rather than renaming
              onto it — a rename that quietly folded two teams together would be a merge nobody
              asked for.
            </>
          ) : nextId !== team.id ? (
            <>
              The id becomes <code>{nextId}</code>, and <code>{team.id}</code> is kept as an alias so
              everything already spelt that way still resolves here.
            </>
          ) : (
            <>
              The id stays <code>{team.id}</code>
              {derived ? '.' : ', because it was not derived from the name.'}
            </>
          )}
        </p>

        <label className="stack" style={{ gap: 4 }}>
          <span className="nav-group-label">Department</span>
          <input
            value={department}
            list="team-departments"
            placeholder="None"
            onChange={(e) => setDepartment(e.target.value)}
          />
          <datalist id="team-departments">
            {departments.map((d) => (
              <option key={d.id} value={d.name} />
            ))}
          </datalist>
          <span className="muted" style={{ fontSize: 11 }}>
            Pick one or type a new one — a department that does not exist yet is created.
          </span>
        </label>

        <label className="stack" style={{ gap: 4 }}>
          <span className="nav-group-label">Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <label className="stack" style={{ gap: 4 }}>
          <span className="nav-group-label">Contact</span>
          <input value={contact} placeholder="#a-channel" onChange={(e) => setContact(e.target.value)} />
        </label>

        {team.aliases.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="nav-group-label">Also known as</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {team.aliases.map((a) => (
                <span key={a} className="pill">
                  <code>{a}</code>
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`Stop treating ${a} as this team`}
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.del<{ id: string }>(`/team/alias?alias=${encodeURIComponent(a)}`))
                    }
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 11 }}>
              Removing one un-merges it: it becomes a team of its own again wherever the data still
              spells it that way.
            </span>
          </div>
        )}

        {!configured && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            There is no <code>teams.json</code> yet, and saving writes one. From then on a team that
            is not in it is reported as unregistered — which is the point of having one, but it
            means every other team will want naming too.
          </p>
        )}

        {error && (
          <p className="pill bad" style={{ fontSize: 12, margin: 0 }}>
            {error}
          </p>
        )}

        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="primary" disabled={busy || !trimmed || clash}>
            Save
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>

      <hr style={{ margin: '16px 0', border: 0, borderTop: '1px solid var(--border)' }} />

      <div className="stack" style={{ gap: 8 }}>
        <span className="nav-group-label">Merge into another team</span>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          {team.name} disappears and everything it owns moves across. Nothing is rewritten: the
          manifests still say what the scan found, and the registry records that{' '}
          <code>{team.id}</code> means the other one. Remove the alias to undo it.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <select
            value={into}
            aria-label="Merge into"
            disabled={busy || !others.length}
            onChange={(e) => setInto(e.target.value)}
          >
            <option value="">Choose a team…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost"
            disabled={busy || !into}
            onClick={() => void run(() => api.post<{ id: string }>('/team/merge', { from: team.id, into }))}
          >
            {into ? `Merge ${team.name} into ${others.find((t) => t.id === into)?.name}` : 'Merge'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
