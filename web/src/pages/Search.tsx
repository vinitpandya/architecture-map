import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type SearchHit } from '../lib/api'
import { useScope } from '../lib/scope'
import { Card, Empty } from '../components/ui'
import { KIND_PLURAL, idValue, nodeHref, processHref, teamHref } from '../lib/nodes'
import type { NodeKind } from '../lib/api'

const GROUP_LABEL: Record<string, string> = {
  edge: 'Relationships',
  unresolved: 'Unresolved references',
  process: 'Business processes',
  team: 'Teams',
}

const groupLabel = (kind: string) => GROUP_LABEL[kind] ?? KIND_PLURAL[kind as NodeKind] ?? kind

/** Where a hit goes. An edge is a relationship, not a place, so it lands on
 *  the thing it points at; an unresolved reference has nowhere to go at all. */
const hitHref = (h: SearchHit) =>
  h.subject_kind === 'node'
    ? nodeHref(h.subject_id)
    : h.subject_kind === 'process'
      ? processHref(h.subject_id.slice(5))
      : h.subject_kind === 'team'
        ? teamHref(h.subject_id.slice(5))
        : h.to
        ? nodeHref(h.to)
        : null

/**
 * Text search over nodes, edges and — importantly — the evidence snippets, so
 * searching for `@KafkaListener` or a table name finds the code it came from.
 */
export function SearchPage() {
  const { status } = useScope()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [cursor, setCursor] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      api
        .get<{ hits: SearchHit[] }>('/search', { q })
        .then((d) => !cancelled && setHits(d.hits))
        .catch(() => !cancelled && setHits([]))
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q])

  // Grouped for reading, flat for the keyboard — the order has to be the same
  // in both or ↓ jumps around the page.
  const grouped = useMemo(() => {
    const by = new Map<string, SearchHit[]>()
    for (const h of hits) {
      if (!by.has(h.kind)) by.set(h.kind, [])
      by.get(h.kind)!.push(h)
    }
    return [...by.entries()]
  }, [hits])

  const flat = useMemo(() => grouped.flatMap(([, rows]) => rows), [grouped])

  useEffect(() => setCursor(0), [hits])

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!flat.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      const href = hitHref(flat[cursor])
      if (href) navigate(href)
    } else if (e.key === 'Escape') {
      setQ('')
    }
  }

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
        placeholder="e.g. payments.settled.v1, KafkaListener, kind:topic orders"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Search the estate"
        style={{ width: '100%', fontSize: 15, padding: '10px 12px' }}
      />

      {!q.trim() ? (
        <Card title="The estate" sub="↑ ↓ to move through results, Enter to open one">
          {status?.ready ? (
            <ul>
              <li>{status.counts.services} services</li>
              <li>{status.counts.topics} Kafka topics</li>
              <li>
                {status.counts.databases} databases, {status.counts.caches} caches
              </li>
              <li>
                {status.counts.contracts} contracts, {status.counts.endpoints} endpoints
              </li>
              <li>{status.counts.edges} relationships</li>
            </ul>
          ) : (
            <Empty title="Nothing ingested yet">
              <Link to="/scan">Scan a repository →</Link>
            </Empty>
          )}
        </Card>
      ) : !hits.length ? (
        <Empty title={`Nothing matches "${q}"`} />
      ) : (
        <div ref={list}>
          {grouped.map(([kind, rows]) => (
            <Card
              key={kind}
              title={groupLabel(kind)}
              sub={`${rows.length} result${rows.length === 1 ? '' : 's'}`}
            >
              <ul className="search-hits">
                {rows.map((h) => (
                  <Hit key={`${h.subject_kind}:${h.subject_id}`} hit={h} active={flat[cursor] === h} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function Hit({ hit, active }: { hit: SearchHit; active: boolean }) {
  const href = hitHref(hit)
  return (
    <li data-active={active} className={active ? 'active' : undefined}>
      {href ? <Link to={href}>{hit.title}</Link> : <span>{hit.title}</span>}
      {hit.subject_kind === 'unresolved' && <span className="pill">could not be resolved</span>}
      {(hit.repo || hit.subject_kind === 'node') && (
        <code className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
          {hit.subject_kind === 'node' ? idValue(hit.subject_id) : hit.repo}
        </code>
      )}
      {hit.snippet && (
        <span
          className="muted"
          style={{ fontSize: 12, display: 'block' }}
          // The excerpt is FTS5's own <mark> highlight of indexed text.
          dangerouslySetInnerHTML={{ __html: hit.snippet }}
        />
      )}
    </li>
  )
}
