import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type AuthStatus, type Project, type Site, type StatusMapping } from '../lib/api'
import { useScope } from '../lib/scope'
import { Card, Banner, Meter } from '../components/ui'
import { duration, full, relative } from '../lib/format'

export function Settings() {
  const { sync, startSync, cancelSync, refreshCatalog, catalog } = useScope()
  const [params, setParams] = useSearchParams()
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [activeSite, setActiveSite] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const load = useCallback(async () => {
    try {
      const a = await api.get<AuthStatus>('/auth/status')
      setAuth(a)
      if (a.connected) {
        const s = await api.get<{ sites: Site[]; active: string | null }>('/sites')
        setSites(s.sites)
        setActiveSite(s.active)
        const p = await api.get<{ projects: Project[]; selected: string[] }>('/projects')
        setProjects(p.projects)
        setSelected(p.selected)
      }
    } catch (err) {
      setNotice({ kind: 'error', text: String((err as Error).message) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, sync?.last?.finishedAt])

  useEffect(() => {
    const err = params.get('error')
    const ok = params.get('connected')
    if (err) setNotice({ kind: 'error', text: err })
    if (ok) setNotice({ kind: 'info', text: 'Connected to Jira. Choose the projects to cache below.' })
    if (err || ok) {
      params.delete('error')
      params.delete('connected')
      setParams(params, { replace: true })
      void load()
    }
  }, [params, setParams, load])

  const saveCredentials = async () => {
    setSaving(true)
    try {
      const next = await api.post<AuthStatus>('/auth/credentials', {
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      })
      setAuth(next)
      setClientSecret('')
      setNotice({ kind: 'info', text: 'Credentials saved locally.' })
    } catch (err) {
      setNotice({ kind: 'error', text: String((err as Error).message) })
    } finally {
      setSaving(false)
    }
  }

  const saveProjects = async (keys: string[]) => {
    setSelected(keys)
    await api.post('/projects/select', { keys })
  }

  const running = sync?.running ?? false
  const last = sync?.last

  return (
    <div className="page" style={{ maxWidth: 940 }}>
      <div className="page-head">
        <div>
          <h1>Connection &amp; sync</h1>
          <p>
            The client secret and the cached issues stay on this machine — in{' '}
            <code>data/jira.sqlite</code> next to the server. Nothing is sent anywhere except Atlassian.
          </p>
        </div>
      </div>

      {notice && (
        <Banner
          kind={notice.kind === 'error' ? 'error' : 'info'}
          title={notice.kind === 'error' ? 'Something went wrong' : 'Done'}
          actions={
            <button type="button" className="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          }
        >
          {notice.text}
        </Banner>
      )}

      <div className="stack">
        {/* ---------------------------------------------------- step 1 */}
        <Card
          title="1 · Atlassian app credentials"
          sub="Create an OAuth 2.0 (3LO) app in the developer console, then paste its client ID and secret."
        >
          <p className="muted" style={{ marginTop: 0 }}>
            In{' '}
            <a href="https://developer.atlassian.com/console/myapps/" target="_blank" rel="noreferrer">
              developer.atlassian.com/console/myapps
            </a>{' '}
            create an app, add the <strong>Jira API</strong> permission with the{' '}
            <code>read:jira-work</code> and <code>read:jira-user</code> scopes, and set the callback URL to
            exactly:
          </p>
          <p>
            <code
              style={{
                display: 'inline-block',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 8px',
              }}
            >
              {auth?.redirectUri ?? 'http://localhost:8787/api/auth/callback'}
            </code>
          </p>

          {auth?.credentialSource === 'env' ? (
            <p className="muted">
              Credentials are coming from <code>.env</code> (client ID {auth.clientId}). Fill the fields
              below to override them for this machine.
            </p>
          ) : auth?.configured ? (
            <p className="muted">
              Stored locally — client ID {auth.clientId}, secret present. Re-enter to replace.
            </p>
          ) : null}

          <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <div className="field" style={{ flex: '1 1 260px' }}>
              <label htmlFor="cid">Client ID</label>
              <input
                id="cid"
                type="text"
                value={clientId}
                autoComplete="off"
                placeholder={auth?.clientId ?? 'e.g. 4XmT…'}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: '1 1 260px' }}>
              <label htmlFor="csec">Client secret</label>
              <input
                id="csec"
                type="password"
                value={clientSecret}
                autoComplete="off"
                placeholder={auth?.hasSecret ? '•••••••• (stored)' : 'paste the secret'}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => void saveCredentials()}
              disabled={saving || (!clientId && !clientSecret)}
            >
              Save
            </button>
          </div>
        </Card>

        {/* ---------------------------------------------------- step 2 */}
        <Card title="2 · Authorise" sub="Opens Atlassian's consent screen and returns here.">
          <div className="row">
            {auth?.connected ? (
              <>
                <span className="pill">
                  <span className="dot" style={{ background: 'var(--status-good)' }} />
                  Connected
                </span>
                <span className="muted">
                  Access token renews automatically
                  {auth.expiresAt ? ` · current one expires ${relative(auth.expiresAt)}` : ''}
                </span>
                <div className="spacer" style={{ flex: 1 }} />
                <button
                  type="button"
                  className="danger"
                  onClick={async () => {
                    await api.post('/auth/disconnect')
                    void load()
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                {/* Not an <a> — a disabled button inside a link still navigates. */}
                <button
                  type="button"
                  className="primary"
                  disabled={!auth?.configured}
                  onClick={() => {
                    window.location.href = '/api/auth/login'
                  }}
                >
                  Connect to Jira
                </button>
                {!auth?.configured && <span className="muted">Add the client ID and secret first.</span>}
              </>
            )}
          </div>

          {auth?.connected && sites.length > 0 && (
            <div className="field" style={{ marginTop: 16, maxWidth: 420 }}>
              <label htmlFor="site">Jira site</label>
              <select
                id="site"
                value={activeSite ?? ''}
                onChange={async (e) => {
                  await api.post('/sites/select', { cloudId: e.target.value })
                  setActiveSite(e.target.value)
                  void load()
                  void refreshCatalog()
                }}
              >
                {sites.map((s) => (
                  <option key={s.cloud_id} value={s.cloud_id}>
                    {s.name} — {s.url}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Card>

        {/* ---------------------------------------------------- step 3 */}
        <Card
          title="3 · Projects to cache"
          sub="Only these are pulled. Parent initiatives that live in other projects are fetched automatically."
          actions={
            projects.length > 0 && (
              <>
                <button type="button" className="ghost" onClick={() => void saveProjects(projects.map((p) => p.key))}>
                  Select all
                </button>
                <button type="button" className="ghost" onClick={() => void saveProjects([])}>
                  Clear
                </button>
              </>
            )
          }
        >
          {!auth?.connected ? (
            <p className="muted">Connect first.</p>
          ) : projects.length === 0 ? (
            <p className="muted">
              No projects visible yet — run a sync once to fetch the project list, or check the app's
              scopes.
            </p>
          ) : (
            <>
              <div className="checklist">
                {projects.map((p) => (
                  <label key={p.key} className="checkrow">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.key)}
                      onChange={(e) =>
                        void saveProjects(
                          e.target.checked
                            ? [...selected, p.key]
                            : selected.filter((k) => k !== p.key)
                        )
                      }
                    />
                    <span className="grow">
                      <strong>{p.key}</strong> · {p.name}
                      {p.type_key === 'product_discovery' && <span className="muted"> · Discovery</span>}
                    </span>
                    <span className="count">{p.issue_count ? `${full(p.issue_count)} cached` : ''}</span>
                  </label>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 8, marginBottom: 0 }}>
                {selected.length === 0
                  ? 'Nothing selected — a sync would pull every project you can see, which can be very large.'
                  : `${selected.length} project(s) selected.`}
              </p>
            </>
          )}
        </Card>

        {/* ---------------------------------------------------- step 4 */}
        <Card
          title="4 · Sync"
          sub="Incremental only re-reads issues changed since the last run. Full rebuild re-reads everything."
        >
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={!auth?.connected || running}
              onClick={() => void startSync('incremental')}
            >
              {running ? 'Syncing…' : 'Refresh now'}
            </button>
            <button
              type="button"
              disabled={!auth?.connected || running}
              onClick={() => void startSync('full')}
            >
              Full rebuild
            </button>
            {running && (
              <button type="button" className="ghost" onClick={() => void cancelSync()}>
                Stop
              </button>
            )}
          </div>

          {running && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="spinner" />
                <strong style={{ fontSize: 13 }}>{sync?.phase}</strong>
                <span className="muted">{sync?.message}</span>
              </div>
              {sync?.counts?.changelogTotal ? (
                <div style={{ marginTop: 10, maxWidth: 420 }}>
                  <Meter
                    done={sync.counts.changelogs ?? 0}
                    total={sync.counts.changelogTotal}
                    showLabel
                  />
                </div>
              ) : null}
            </div>
          )}

          {!running && last && (
            <div style={{ marginTop: 14 }}>
              <table className="data" style={{ maxWidth: 480 }}>
                <tbody>
                  <tr>
                    <th style={{ position: 'static' }}>Last run</th>
                    <td>
                      {last.status === 'ok' ? 'Succeeded' : last.status === 'cancelled' ? 'Stopped' : 'Failed'} ·{' '}
                      {relative(last.finishedAt)} · {last.mode}
                      {last.finishedAt ? ` · took ${duration(last.finishedAt - last.startedAt)}` : ''}
                    </td>
                  </tr>
                  {last.stats && (
                    <>
                      <tr>
                        <th style={{ position: 'static' }}>Issues read</th>
                        <td>{full(last.stats.issues)}</td>
                      </tr>
                      <tr>
                        <th style={{ position: 'static' }}>Histories read</th>
                        <td>{full(last.stats.changelogs)}</td>
                      </tr>
                      <tr>
                        <th style={{ position: 'static' }}>Issues cached</th>
                        <td>{full(last.stats.issuesInDb)}</td>
                      </tr>
                    </>
                  )}
                  {last.error && (
                    <tr>
                      <th style={{ position: 'static' }}>Error</th>
                      <td style={{ whiteSpace: 'normal', color: 'var(--status-critical)' }}>{last.error}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {catalog?.ready && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>
              Cache holds {full(catalog.totals?.issues ?? 0)} issues across{' '}
              {catalog.projects?.length ?? 0} project(s).
            </p>
          )}
        </Card>

        {catalog?.ready && <WorkflowStatesCard />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- workflow states */

const CATEGORY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'new', label: 'To do' },
  { value: 'indeterminate', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const CATEGORY_LABEL: Record<string, string> = {
  new: 'To do',
  indeterminate: 'In progress',
  done: 'Done',
}

/**
 * Group statuses into to do / in progress / done for every report. "Auto"
 * uses Jira's category plus the done-like name rule; an override pins it.
 */
function WorkflowStatesCard() {
  const { reload } = useScope()
  const [mapping, setMapping] = useState<StatusMapping | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [savingMap, setSavingMap] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  const loadMapping = useCallback(async () => {
    const d = await api.get<StatusMapping>('/status-mapping')
    setMapping(d)
    setOverrides(
      Object.fromEntries(d.statuses.filter((s) => s.override).map((s) => [s.name, s.override!]))
    )
    setDirty(false)
  }, [])

  useEffect(() => {
    void loadMapping()
  }, [loadMapping])

  const save = async () => {
    setSavingMap(true)
    try {
      await api.put('/status-mapping', { overrides })
      await loadMapping()
      reload() // refetch every report with the new grouping
      setSavedNote(true)
      window.setTimeout(() => setSavedNote(false), 1800)
    } finally {
      setSavingMap(false)
    }
  }

  if (!mapping?.statuses.length) return null

  return (
    <Card
      title="Workflow states"
      sub="Group your statuses into to do / in progress / done — e.g. count “QA Done” as done. Auto follows Jira's category plus the done-like name rule."
      actions={
        <button type="button" className="primary" disabled={!dirty || savingMap} onClick={() => void save()}>
          {savedNote ? 'Saved ✓' : savingMap ? 'Saving…' : 'Save mapping'}
        </button>
      }
    >
      <table className="data" style={{ maxWidth: 680 }}>
        <thead>
          <tr>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Issues</th>
            <th>Counts as</th>
          </tr>
        </thead>
        <tbody>
          {mapping.statuses.map((s) => {
            const current = overrides[s.name] ?? 'auto'
            return (
              <tr key={s.name}>
                <td>
                  {s.name}
                  {current === 'auto' && (
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {'  '}→ {CATEGORY_LABEL[s.effective] ?? s.effective}
                    </span>
                  )}
                </td>
                <td className="num">{full(s.count)}</td>
                <td>
                  <div className="segmented" role="group" aria-label={`Category for ${s.name}`}>
                    {CATEGORY_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={current === o.value}
                        style={{ padding: '3px 8px', fontSize: 11.5 }}
                        onClick={() => {
                          setOverrides((prev) => {
                            const next = { ...prev }
                            if (o.value === 'auto') delete next[s.name]
                            else next[s.name] = o.value
                            return next
                          })
                          setDirty(true)
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
