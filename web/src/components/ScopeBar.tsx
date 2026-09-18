import { useEffect, useState } from 'react'
import { api, type GraphNode } from '../lib/api'
import { ALL_NODE_KINDS, useScope } from '../lib/scope'
import { KIND_PLURAL, idValue } from '../lib/nodes'
import { Picker, type Option } from './Picker'

/**
 * The filter row. One row above everything, scoping every widget on the page:
 * what to focus on, how far out to reach, and which kinds of thing to show.
 */
export function ScopeBar() {
  const { scope, setScope, resetScope, status } = useScope()
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [loading, setLoading] = useState(false)

  // The focus picker searches the whole estate, not just what is on screen.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<{ nodes: GraphNode[] }>('/nodes', { limit: 500 })
      .then((d) => !cancelled && setNodes(d.nodes))
      .catch(() => !cancelled && setNodes([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [status?.lastIngestAt])

  const focusOptions: Option[] = nodes.map((n) => ({
    value: n.id,
    label: n.name,
    sub: idValue(n.id),
    count: n.degree,
  }))

  const kindOptions: Option[] = ALL_NODE_KINDS.map((k) => ({
    value: k,
    label: KIND_PLURAL[k],
    count: status?.counts[
      ({
        service: 'services',
        'kafka.topic': 'topics',
        database: 'databases',
        cache: 'caches',
        endpoint: 'endpoints',
        contract: 'contracts',
        external: 'externals',
      } as const)[k]
    ],
  }))

  const repoOptions: Option[] = (status?.repos ?? []).map((r) => ({ value: r.repo, label: r.repo }))

  return (
    <div className="scope-bar">
      <Picker
        label="Focus"
        options={focusOptions}
        selected={scope.focus ? [scope.focus] : []}
        onChange={(next) => setScope({ focus: next[0] ?? '' })}
        multiple={false}
        placeholder="Whole estate"
        emptyText="Nothing ingested yet"
        width={280}
        loading={loading}
      />

      <div className="segmented" role="group" aria-label="Depth">
        {(['1', '2', 'all'] as const).map((d) => (
          <button
            key={d}
            type="button"
            disabled={!scope.focus}
            aria-pressed={scope.depth === d}
            onClick={() => setScope({ depth: d })}
            title={scope.focus ? undefined : 'Pick a focus first'}
          >
            {d === 'all' ? 'All' : `${d} hop${d === '1' ? '' : 's'}`}
          </button>
        ))}
      </div>

      <Picker
        label="Show"
        options={kindOptions}
        selected={scope.kinds}
        onChange={(kinds) => setScope({ kinds })}
        placeholder="Everything"
        width={230}
      />

      {repoOptions.length > 0 && (
        <Picker
          label="Repos"
          options={repoOptions}
          selected={scope.repos}
          onChange={(repos) => setScope({ repos })}
          placeholder="All repos"
          width={200}
        />
      )}

      <label className="row" style={{ gap: 6, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={scope.includeExternal}
          onChange={(e) => setScope({ includeExternal: e.target.checked })}
        />
        External
      </label>

      <button type="button" className="ghost" onClick={resetScope} style={{ marginLeft: 'auto' }}>
        Reset
      </button>
    </div>
  )
}
