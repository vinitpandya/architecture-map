import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type NodeDetail } from '../lib/api'
import { Card, Empty } from '../components/ui'
import { DataGrid } from '../components/DataGrid'
import { EvidenceList } from '../components/EvidenceList'
import { EDGE_LABEL, KIND_LABEL, idValue, nodeHref } from '../lib/nodes'

/**
 * Node ids carry `:`, `/`, spaces and `{}`, so they travel as a query
 * parameter and never as a path segment.
 */
export function NodePage() {
  const [params] = useSearchParams()
  const id = params.get('id') ?? ''
  const [data, setData] = useState<NodeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    if (!id) return
    api
      .get<NodeDetail>('/node', { id })
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(String((err as Error).message)))
    return () => {
      cancelled = true
    }
  }, [id])

  if (!id) return <div className="page"><Empty title="No node selected" /></div>
  if (error) return <div className="page"><Empty title={error}><code>{id}</code></Empty></div>
  if (!data) return null

  const { node } = data
  const edgeColumns = (side: 'from' | 'to') => [
    { key: 'kind', label: 'Relationship', value: (e: NodeDetail['out'][number]) => EDGE_LABEL[e.kind] ?? e.kind },
    {
      key: 'other',
      label: side === 'to' ? 'Target' : 'Source',
      value: (e: NodeDetail['out'][number]) => idValue(side === 'to' ? e.to : e.from),
      render: (e: NodeDetail['out'][number]) => (
        <Link to={nodeHref(side === 'to' ? e.to : e.from)}>{idValue(side === 'to' ? e.to : e.from)}</Link>
      ),
    },
    { key: 'description', label: 'What it does', wide: true, value: (e: NodeDetail['out'][number]) => e.description ?? '' },
    { key: 'confidence', label: 'Confidence', value: (e: NodeDetail['out'][number]) => e.confidence },
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{node.name}</h1>
          <p>
            <span className="pill">{KIND_LABEL[node.kind]}</span>{' '}
            {node.ownerRepo ? <>owned by <code>{node.ownerRepo}</code></> : 'no owning repo'}
            {node.team ? <> · {node.team}</> : null}
            {node.orphan ? <> · referenced but never declared</> : null}
          </p>
        </div>
      </div>

      <code className="muted" style={{ fontSize: 12 }}>{node.id}</code>

      {node.description && <p>{node.description}</p>}

      {data.drift.length > 0 && (
        <Card title="Findings">
          <ul>
            {data.drift.map((f) => (
              <li key={f.id}>
                <strong>{f.kind}</strong> — {f.detail}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Outgoing (${data.out.length})`}>
        {data.out.length ? (
          <DataGrid rows={data.out} columns={edgeColumns('to')} rowKey={(e) => e.id} />
        ) : (
          <Empty title="Nothing outgoing" />
        )}
      </Card>

      <Card title={`Incoming (${data.in.length})`}>
        {data.in.length ? (
          <DataGrid rows={data.in} columns={edgeColumns('from')} rowKey={(e) => e.id} />
        ) : (
          <Empty title="Nothing incoming" />
        )}
      </Card>

      {data.bindings.length > 0 && (
        <Card title="Contract versions">
          <DataGrid
            rows={data.bindings}
            rowKey={(b) => `${b.contract_id}|${b.service_id}`}
            columns={[
              { key: 'contract', label: 'Contract', value: (b) => idValue(b.contract_id) },
              { key: 'service', label: 'Service', value: (b) => idValue(b.service_id) },
              { key: 'version', label: 'Version', value: (b) => b.version ?? '' },
            ]}
          />
        </Card>
      )}

      <Card title="Evidence" sub="Where this is visible in the source">
        <EvidenceList evidence={data.evidence} />
      </Card>
    </div>
  )
}
