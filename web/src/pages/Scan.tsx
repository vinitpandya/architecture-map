import { useEffect, useState } from 'react'
import { api, type ProcessPack, type RepoRow } from '../lib/api'
import { useScope } from '../lib/scope'
import { Banner, Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'

/**
 * The operator page. The app renders the prompt; a human runs it against the
 * repository and drops the result in the inbox. Nothing here reaches the
 * network — deliberately, so how the JSON is produced stays interchangeable.
 */
export function ScanPage() {
  const { sweepInbox, ingesting, ingestError, status } = useScope()
  const [repos, setRepos] = useState<RepoRow[]>([])
  const [configured, setConfigured] = useState(true)
  const [repo, setRepo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  // One page a person comes to for a prompt; which prompt is a tab.
  const [tab, setTab] = useState<'repository' | 'processes'>('repository')
  const [packs, setPacks] = useState<ProcessPack[]>([])
  const [pack, setPack] = useState('')

  useEffect(() => {
    api
      .get<{ repos: RepoRow[]; configured: boolean }>('/repos')
      .then((d) => {
        setRepos(d.repos)
        setConfigured(d.configured)
        if (d.repos.length && !repo) setRepo(d.repos[0].repo)
      })
      .catch(() => setRepos([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.lastIngestAt])

  useEffect(() => {
    api
      .get<{ packs: ProcessPack[] }>('/process-packs')
      .then((d) => {
        const active = d.packs.filter((p) => p.status === 'active')
        setPacks(active)
        if (active.length && !pack) setPack(active[0].pack)
      })
      .catch(() => setPacks([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.lastIngestAt])

  useEffect(() => {
    const name = tab === 'processes' ? 'author-processes' : 'scan-pass1'
    api
      .get<{ text: string }>('/prompt', { name, repo, pack })
      .then((d) => setPrompt(d.text))
      .catch(() => setPrompt(''))
  }, [repo, pack, tab])

  const copy = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scan</h1>
          <p>Copy the prompt, run it inside the repository, drop the JSON in the inbox.</p>
        </div>
        <div className="row">
          <button type="button" className="primary" disabled={ingesting} onClick={() => void sweepInbox()}>
            {ingesting ? 'Sweeping…' : 'Sweep inbox'}
          </button>
        </div>
      </div>

      {ingestError && <Banner kind="error" title="Ingest failed">{ingestError}</Banner>}

      <Card title="Repositories" sub={configured ? undefined : 'No repos.json yet'}>
        {repos.length ? (
          <DataGrid
            rows={repos}
            columns={[
              { key: 'repo', label: 'Repository', value: (r) => r.repo },
              {
                key: 'commit',
                label: 'Last scanned commit',
                value: (r) => r.commit ?? '',
                render: (r) => (r.commit ? <code>{r.commit}</code> : <span className="muted">never scanned</span>),
              },
              { key: 'scannedAt', label: 'Scanned', value: (r) => r.scannedAt ?? '' },
            ]}
            rowKey={(r) => r.repo}
          />
        ) : (
          <Empty title="No repositories configured">
            <span className="muted" style={{ fontSize: 12 }}>
              Copy <code>repos.example.json</code> to <code>repos.json</code> and list your repositories.
            </span>
          </Empty>
        )}
      </Card>

      <Card
        title={tab === 'processes' ? 'Process authoring prompt' : 'Pass 1 prompt'}
        sub={
          tab === 'processes'
            ? 'Run this with whatever describes the processes — a Confluence export, a diagram, an interview'
            : 'Run this from a checkout of the repository'
        }
        actions={
          <>
            <div className="segmented" role="group" aria-label="Prompt">
              <button type="button" aria-pressed={tab === 'repository'} onClick={() => setTab('repository')}>
                Repository
              </button>
              <button type="button" aria-pressed={tab === 'processes'} onClick={() => setTab('processes')}>
                Processes
              </button>
            </div>
            {tab === 'processes' ? (
              <input
                type="text"
                list="scan-packs"
                value={pack}
                placeholder="pack id, e.g. onboarding"
                aria-label="Pack"
                onChange={(e) => setPack(e.target.value)}
                style={{ width: 190 }}
              />
            ) : (
              <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository">
                {repos.length === 0 && <option value="">(no repos.json)</option>}
                {repos.map((r) => (
                  <option key={r.repo} value={r.repo}>
                    {r.repo}
                  </option>
                ))}
              </select>
            )}
            <datalist id="scan-packs">
              {packs.map((p) => (
                <option key={p.pack} value={p.pack} />
              ))}
            </datalist>
            <button type="button" className="ghost" onClick={() => void copy()} disabled={!prompt}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </>
        }
      >
        {tab === 'processes' && (
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            The prompt carries every component currently in the map and every code already in use, because
            its central rule is that a pack may only reference components a scan has already found.
          </p>
        )}
        {prompt ? (
          <pre className="prompt-box">
            <code>{prompt}</code>
          </pre>
        ) : (
          <Empty title="Prompt unavailable" />
        )}
      </Card>
    </div>
  )
}
