import { useEffect, useState } from 'react'
import { api, type ManifestRow } from '../lib/api'
import { useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'

/** The ingest log. A quarantined row expands to the validation errors. */
export function ManifestsPage() {
  const { status } = useScope()
  const [rows, setRows] = useState<ManifestRow[]>([])
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    api
      .get<{ manifests: ManifestRow[] }>('/manifests')
      .then((d) => setRows(d.manifests))
      .catch(() => setRows([]))
  }, [status?.lastIngestAt])

  if (!rows.length) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Manifests</h1>
            <p>Every manifest that has been through ingest, newest first.</p>
          </div>
        </div>
        <Empty title="Nothing ingested yet" />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Manifests</h1>
          <p>Every manifest that has been through ingest, newest first.</p>
        </div>
      </div>

      {rows.map((m) => (
        <Card
          key={m.id}
          title={m.repo}
          sub={`${m.status} · ${m.producer_kind ?? 'unknown producer'} · ${m.ingested_at}`}
          actions={
            m.status === 'quarantined' && (
              <button type="button" className="ghost" onClick={() => setOpen(open === m.id ? null : m.id)}>
                {open === m.id ? 'Hide errors' : `${m.errors?.length ?? 0} errors`}
              </button>
            )
          }
        >
          <div className="muted" style={{ fontSize: 12 }}>
            {m.commit_sha ? <code>{m.commit_sha}</code> : 'no commit'}
            {m.service_id ? ` · ${m.service_id}` : ''}
            {m.source_file ? ` · ${m.source_file}` : ''}
            {m.prompt_version ? ` · prompt ${m.prompt_version}` : ''}
          </div>

          {open === m.id && m.errors && (
            <ul className="error-list">
              {m.errors.map((e, i) => (
                <li key={i}>
                  <code>{e.path}</code> — {e.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  )
}
