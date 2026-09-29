import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ManifestRow, type ProcessPack } from '../lib/api'
import { idValue } from '../lib/nodes'
import { useScope } from '../lib/scope'
import { Banner, Card, Empty } from '../components/ui'
import { ListSearch, MatchedIn, NoMatch, textOf, useSearch } from '../components/SearchBox'

type Doc = { kind: 'pack'; pack: ProcessPack } | { kind: 'manifest'; manifest: ManifestRow }

const errorText = (e: { path: string; message: string }) => textOf(e.path, e.message)

/**
 * What an ingested document is found by. Superseded ones are kept, so this
 * log only grows, and the one worth finding is usually a single quarantined
 * file — by its repo, its pack, its status, or the words of its error.
 */
const docText = (d: Doc) =>
  d.kind === 'pack'
    ? textOf(
        d.pack.name,
        d.pack.pack,
        d.pack.status,
        d.pack.producer_kind,
        d.pack.source_file,
        d.pack.prompt_version,
        d.pack.description,
        d.pack.source?.title,
        d.pack.covers?.team,
        ...(d.pack.covers?.services ?? []),
        ...(d.pack.errors ?? []).map(errorText)
      )
    : textOf(
        d.manifest.repo,
        d.manifest.status,
        d.manifest.producer_kind,
        d.manifest.commit_sha,
        d.manifest.service_id,
        d.manifest.source_file,
        d.manifest.prompt_version,
        ...(d.manifest.errors ?? []).map(errorText)
      )

/**
 * The ingest log, for both things that arrive through the inbox: scan
 * manifests derived from a repository, and process packs written by people.
 * They route by shape on the way in, and they read side by side here.
 *
 * A quarantined row of either kind expands to its validation errors, and a
 * scan set aside for shrinking can be applied from here — this is the only
 * screen that still holds the body that was refused.
 */
export function ManifestsPage() {
  const { status, reload } = useScope()
  const [rows, setRows] = useState<ManifestRow[]>([])
  const [packs, setPacks] = useState<ProcessPack[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [applying, setApplying] = useState<number | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const docs: Doc[] = [
    ...packs.map((pack) => ({ kind: 'pack' as const, pack })),
    ...rows.map((manifest) => ({ kind: 'manifest' as const, manifest })),
  ]
  const search = useSearch(docs, docText)
  const shownPacks = search.matches.flatMap((d) => (d.kind === 'pack' ? [d.pack] : []))
  const shownRows = search.matches.flatMap((d) => (d.kind === 'manifest' ? [d.manifest] : []))

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

  /* Applying a refused scan is a decision, not a retry: it deletes whatever
     the previous scan asserted and this one does not. So it reports back
     rather than failing quietly, and the row stays where it is if the server
     still refuses it — which it will if the body was never valid. */
  const applyAnyway = async (id: number) => {
    setApplying(id)
    setFailed(null)
    try {
      const res = await api.post<{ ok?: boolean; errors?: { path: string; message: string }[] }>(
        `/ingest/force?id=${id}`
      )
      if (res.ok === false) setFailed(res.errors?.[0]?.message ?? 'The scan was refused again.')
      reload()
    } catch (err) {
      setFailed(String((err as Error).message))
    } finally {
      setApplying(null)
    }
  }

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

  // An open error list the search reaches into shows the errors that matched,
  // when any did; a document found by its name shows all of them.
  const errors = (key: string, list: { path: string; message: string }[] | null | undefined) => {
    if (open !== key || !list) return null
    const hits = search.q ? list.filter((e) => errorText(e).toLowerCase().includes(search.q)) : []
    return (
      <ul className="error-list">
        {(hits.length ? hits : list).map((e, i) => (
          <li key={i}>
            <code>{e.path}</code> — {e.message}
          </li>
        ))}
      </ul>
    )
  }

  const toggle = (key: string, count: number) => (
    <button type="button" className="ghost" onClick={() => setOpen(open === key ? null : key)}>
      {open === key ? 'Hide errors' : `${count} error${count === 1 ? '' : 's'}`}
    </button>
  )

  return (
    <div className="page">
      {head}

      {failed && (
        <Banner kind="error" title="That scan was not applied">
          {failed}
        </Banner>
      )}

      <ListSearch
        query={search.query}
        onChange={search.setQuery}
        shown={search.matches.length}
        total={docs.length}
        noun="documents"
        label="Search the ingest log"
      />
      {search.narrowed && !search.matches.length && <NoMatch query={search.query} />}

      {shownPacks.length > 0 && (
        <>
          <div className="nav-group-label">Process packs</div>
          {shownPacks.map((p) => {
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
                {p.covers && (p.covers.team || p.covers.services?.length) && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    covers{p.covers.team ? ` ${p.covers.team}` : ''}
                    {p.covers.services?.length
                      ? ` · ${p.covers.services.map((s) => idValue(s)).join(', ')}`
                      : ''}
                  </div>
                )}
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
                {open !== key && (
                  <MatchedIn
                    q={search.q}
                    shown={[p.name, p.pack, p.status, p.producer_kind, p.source_file, p.prompt_version, p.description, p.source?.title, p.covers?.team, ...(p.covers?.services ?? []).map((x) => idValue(x))]}
                    hidden={(p.errors ?? []).map((e) => ['Error', errorText(e)] as [string, string])}
                  />
                )}
                {errors(key, p.errors)}
              </Card>
            )
          })}
        </>
      )}

      {shownRows.length > 0 && (
        <>
          <div className="nav-group-label" style={{ paddingTop: 10 }}>
            Scan manifests
          </div>
          {shownRows.map((m) => {
            const key = `manifest-${m.id}`
            return (
              <Card
                key={key}
                title={m.repo}
                sub={`${m.status} · ${m.producer_kind ?? 'unknown producer'} · ${m.ingested_at}`}
                actions={
                  m.status === 'quarantined' ? (
                    <>
                      {m.refused && (
                        <button
                          type="button"
                          className="ghost"
                          disabled={applying === m.id}
                          onClick={() => void applyAnyway(m.id)}
                        >
                          {applying === m.id ? 'Applying…' : 'Apply anyway'}
                        </button>
                      )}
                      {toggle(key, m.errors?.length ?? 0)}
                    </>
                  ) : undefined
                }
              >
                <div className="muted" style={{ fontSize: 12 }}>
                  {m.commit_sha ? <code>{m.commit_sha}</code> : 'no commit'}
                  {m.service_id ? ` · ${m.service_id}` : ''}
                  {m.source_file ? ` · ${m.source_file}` : ''}
                  {m.prompt_version ? ` · prompt ${m.prompt_version}` : ''}
                </div>
                {open !== key && (
                  <MatchedIn
                    q={search.q}
                    shown={[m.repo, m.status, m.producer_kind, m.commit_sha, m.service_id, m.source_file, m.prompt_version]}
                    hidden={(m.errors ?? []).map((e) => ['Error', errorText(e)] as [string, string])}
                  />
                )}
                {errors(key, m.errors)}
              </Card>
            )
          })}
        </>
      )}
    </div>
  )
}
