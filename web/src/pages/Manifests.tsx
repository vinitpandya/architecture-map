import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ManifestRow, type ProcessPack } from '../lib/api'
import { useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'

/**
 * The ingest log, for both things that arrive through the inbox: scan
 * manifests derived from a repository, and process packs written by people.
 * They route by shape on the way in, and they read side by side here.
 *
 * A quarantined row of either kind expands to its validation errors.
 */
export function ManifestsPage() {
  const { status } = useScope()
  const [rows, setRows] = useState<ManifestRow[]>([])
  const [packs, setPacks] = useState<ProcessPack[]>([])
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ manifests: ManifestRow[] }>('/manifests')
      .then((d) => setRows(d.manifests))
      .catch(() => setRows([]))
    api
      .get<{ packs: ProcessPack[] }>('/process-packs')
      .then((d) => setPacks(d.packs))
      .catch(() => setPacks([]))
  }, [status?.lastIngestAt])

  const head = (
    <div className="page-head">
      <div>
        <h1>Ingest log</h1>
        <p>
          Everything that has been through ingest, newest first — scan manifests derived from a
          repository, and process packs written by people.
        </p>
      </div>
    </div>
  )

  if (!rows.length && !packs.length) {
    return (
      <div className="page">
        {head}
        <Empty title="Nothing ingested yet">
          <span className="muted" style={{ fontSize: 13 }}>
            Drop a manifest or a pack in <code>inbox/</code> and sweep, or run{' '}
            <code>npm run seed:demo</code>.
          </span>
        </Empty>
      </div>
    )
  }

  const errors = (key: string, list: { path: string; message: string }[] | null | undefined) =>
    open === key && list ? (
      <ul className="error-list">
        {list.map((e, i) => (
          <li key={i}>
            <code>{e.path}</code> — {e.message}
          </li>
        ))}
      </ul>
    ) : null

  const toggle = (key: string, count: number) => (
    <button type="button" className="ghost" onClick={() => setOpen(open === key ? null : key)}>
      {open === key ? 'Hide errors' : `${count} error${count === 1 ? '' : 's'}`}
    </button>
  )

  return (
    <div className="page">
      {head}

      {packs.length > 0 && (
        <>
          <div className="nav-group-label">Process packs</div>
          {packs.map((p) => {
            const key = `pack-${p.id}`
            return (
              <Card
                key={key}
                title={p.name || p.pack}
                sub={`${p.status} · ${p.producer_kind ?? 'unknown producer'} · ${p.ingested_at ?? ''}`}
                actions={p.status === 'quarantined' ? toggle(key, p.errors?.length ?? 0) : undefined}
              >
                <div className="muted" style={{ fontSize: 12 }}>
                  <code>{p.pack}</code>
                  {p.processes !== undefined ? ` · ${p.processes} processes` : ''}
                  {p.authored_at ? ` · authored ${p.authored_at.slice(0, 10)}` : ''}
                  {p.source_file ? ` · ${p.source_file}` : ''}
                  {p.prompt_version ? ` · prompt ${p.prompt_version}` : ''}
                </div>
                {p.description && <p style={{ fontSize: 13 }}>{p.description}</p>}
                {p.source?.title && (
                  <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                    From {p.source.url ? (
                      <a href={p.source.url} target="_blank" rel="noreferrer">
                        {p.source.title}
                      </a>
                    ) : (
                      p.source.title
                    )}
                    {p.source.asOf ? `, last confirmed ${p.source.asOf}` : ''}
                  </p>
                )}
                {p.status === 'active' && (
                  <p style={{ fontSize: 13, marginBottom: 0 }}>
                    <Link to="/processes">See its processes →</Link>
                  </p>
                )}
                {errors(key, p.errors)}
              </Card>
            )
          })}
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="nav-group-label" style={{ paddingTop: 10 }}>
            Scan manifests
          </div>
          {rows.map((m) => {
            const key = `manifest-${m.id}`
            return (
              <Card
                key={key}
                title={m.repo}
                sub={`${m.status} · ${m.producer_kind ?? 'unknown producer'} · ${m.ingested_at}`}
                actions={m.status === 'quarantined' ? toggle(key, m.errors?.length ?? 0) : undefined}
              >
                <div className="muted" style={{ fontSize: 12 }}>
                  {m.commit_sha ? <code>{m.commit_sha}</code> : 'no commit'}
                  {m.service_id ? ` · ${m.service_id}` : ''}
                  {m.source_file ? ` · ${m.source_file}` : ''}
                  {m.prompt_version ? ` · prompt ${m.prompt_version}` : ''}
                </div>
                {errors(key, m.errors)}
              </Card>
            )
          })}
        </>
      )}
    </div>
  )
}
