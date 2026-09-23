import { useEffect, useRef, useState } from 'react'
import { api, type IngestResult, type ProcessPack, type RepoRow } from '../lib/api'
import { useScope } from '../lib/scope'
import { Banner, Card, Empty } from '../components/ui'
import { relative } from '../lib/format'
import { DataGrid } from '../components/DataGrid'

/**
 * The operator page. The app renders the prompt; a human runs it against the
 * repository and drops the result in the inbox. Nothing here reaches the
 * network — deliberately, so how the JSON is produced stays interchangeable.
 */
export function ScanPage() {
  const { sweepInbox, ingesting, ingestError, ingestResults, ingestFiles, status } = useScope()
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
              {
                key: 'scannedAt',
                label: 'Scanned',
                // §10 asks for relative time. The ISO string is still the sort
                // value and the tooltip, because "7 days ago" is the answer to
                // "is this stale" and the timestamp is the answer to "when".
                value: (r) => r.scannedAt ?? '',
                render: (r) =>
                  r.scannedAt ? (
                    <span title={r.scannedAt}>{relative(Date.parse(r.scannedAt))}</span>
                  ) : (
                    <span className="muted">never</span>
                  ),
              },
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

      <Inbox
        onFiles={ingestFiles}
        onSweep={sweepInbox}
        busy={ingesting}
        results={ingestResults}
      />

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

/**
 * §10's third section. Two ways in and one account of what happened: drop the
 * documents here, or put them in `inbox/` and sweep. Either way the per-file
 * result is shown — a quarantined file's ajv path is the only thing that tells
 * an operator what to fix, and it used to exist nowhere but the database.
 */
function Inbox({
  onFiles,
  onSweep,
  busy,
  results,
}: {
  onFiles: (files: File[]) => Promise<void>
  onSweep: () => Promise<void>
  busy: boolean
  results: IngestResult[] | null
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.name.endsWith('.json'))
    if (files.length) void onFiles(files)
  }

  return (
    <Card
      title="Inbox"
      sub="A manifest or a process pack — the shape decides which, exactly as the sweep does"
      actions={
        <button type="button" className="ghost" disabled={busy} onClick={() => void onSweep()}>
          {busy ? 'Sweeping…' : 'Sweep inbox'}
        </button>
      }
    >
      <div
        className={`drop-zone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer?.files ?? null)
        }}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop JSON documents here, or choose files"
      >
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          multiple
          hidden
          onChange={(e) => {
            take(e.target.files)
            e.target.value = ''
          }}
        />
        <span>
          Drop <code>.json</code> here, or click to choose. Nothing leaves this machine — the document
          goes straight to the endpoint that validates it.
        </span>
      </div>

      {results && (
        <ul className="ingest-results">
          {results.length === 0 && (
            <li className="muted">The inbox was empty — nothing to sweep.</li>
          )}
          {results.map((r, i) => (
            <li key={`${i}:${r.file}`} className={r.ok ? 'ok' : 'bad'}>
              <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                <code>{r.file}</code>
                <span className="muted" style={{ fontSize: 12 }}>
                  {r.kind === 'process-pack' ? 'process pack' : r.kind === 'manifest' ? 'manifest' : 'not ingestable'}
                </span>
                <span className={`pill ${r.ok ? 'good' : 'bad'}`}>
                  {r.ok ? 'ingested' : r.refused ? 'set aside' : 'quarantined'}
                </span>
              </div>
              {r.errors?.length ? (
                <ul className="ingest-errors">
                  {r.errors.slice(0, 8).map((e, j) => (
                    <li key={`${j}:${e.path}`}>
                      <code>{e.path || '/'}</code> {e.message}
                    </li>
                  ))}
                  {r.errors.length > 8 && (
                    <li className="muted">…and {r.errors.length - 8} more</li>
                  )}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
