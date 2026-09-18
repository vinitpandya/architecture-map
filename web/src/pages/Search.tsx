import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SearchHit } from '../lib/api'
import { useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'
import { nodeHref } from '../lib/nodes'

/**
 * Text search over nodes, edges and — importantly — the evidence snippets, so
 * searching for `@KafkaListener` or a table name finds the code it came from.
 */
export function SearchPage() {
  const { status } = useScope()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      api
        .get<{ hits: SearchHit[] }>('/search', { q })
        .then((d) => !cancelled && setHits(d.hits))
        .catch(() => !cancelled && setHits([]))
        .finally(() => !cancelled && setLoading(false))
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q])

  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    ;(acc[h.subject_kind] ??= []).push(h)
    return acc
  }, {})

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Search</h1>
          <p>Names, descriptions, ids and the code snippets behind every fact.</p>
        </div>
      </div>

      <input
        type="search"
        value={q}
        autoFocus
        placeholder="e.g. payments.settled.v1, KafkaListener, ledger"
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', fontSize: 15, padding: '10px 12px' }}
      />

      {!q.trim() ? (
        <Card title="The estate">
          {status?.ready ? (
            <ul>
              <li>{status.counts.services} services</li>
              <li>{status.counts.topics} Kafka topics</li>
              <li>{status.counts.databases} databases, {status.counts.caches} caches</li>
              <li>{status.counts.contracts} contracts, {status.counts.endpoints} endpoints</li>
              <li>{status.counts.edges} relationships</li>
            </ul>
          ) : (
            <Empty title="Nothing ingested yet">
              <Link to="/scan">Scan a repository →</Link>
            </Empty>
          )}
        </Card>
      ) : !hits.length && !loading ? (
        <Empty title={`Nothing matches "${q}"`} />
      ) : (
        Object.entries(grouped).map(([kind, rows]) => (
          <Card key={kind} title={kind} sub={`${rows.length} result${rows.length === 1 ? '' : 's'}`}>
            <ul className="search-hits">
              {rows.map((h) => (
                <li key={`${h.subject_kind}:${h.subject_id}`}>
                  <Link to={nodeHref(h.subject_id)}>{h.title}</Link>
                  <span
                    className="muted"
                    style={{ fontSize: 12, display: 'block' }}
                    // The excerpt is FTS5's own <mark> highlight of indexed text.
                    dangerouslySetInnerHTML={{ __html: h.excerpt }}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
