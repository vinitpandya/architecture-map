import { useEffect, useState } from 'react'
import { api, type RepoRow } from '../lib/api'
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
      .get<{ text: string }>('/prompt', { name: 'scan-pass1', repo })
      .then((d) => setPrompt(d.text))
      .catch(() => setPrompt(''))
  }, [repo])

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
        title="Pass 1 prompt"
        sub="Run this from a checkout of the repository"
        actions={
          <>
            <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository">
              {repos.length === 0 && <option value="">(no repos.json)</option>}
              {repos.map((r) => (
                <option key={r.repo} value={r.repo}>
                  {r.repo}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={() => void copy()} disabled={!prompt}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </>
        }
      >
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
