import { useEffect, useState } from 'react'
import { api, type GraphNode, type Process } from '../lib/api'
import { ALL_NODE_KINDS, useScope } from '../lib/scope'
import { KIND_PLURAL, displayCode, idValue } from '../lib/nodes'
import { Picker, type Option } from './Picker'

/**
 * The filter row. One row above everything, scoping every widget on the page:
 * what to focus on, how far out to reach, and which kinds of thing to show.
 */
export function ScopeBar() {
  const { scope, setScope, resetScope, status } = useScope()
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [processes, setProcesses] = useState<Process[]>([])
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

  // The process list is small enough to fetch whole, and it only moves when
  // a pack is ingested.
  useEffect(() => {
    let cancelled = false
    api
      .get<{ processes: Process[] }>('/processes')
      .then((d) => !cancelled && setProcesses(d.processes))
      .catch(() => !cancelled && setProcesses([]))
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

  // Indented by level, because the tree is the point: picking a level 1 gives
  // the whole of it, picking a level 2 narrows to that stage.
  const processOptions: Option[] = processes.map((p) => ({
    value: p.code,
    label: `${'\u2003'.repeat(p.level - 1)}${displayCode(p.code)} ${p.name}`,
    sub: p.owner ?? undefined,
    count: p.componentCount,
  }))

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
        // Not "Everything": an empty selection means the API's own default,
        // and §8 makes contracts opt-in there. Tick Contracts to see them.
        placeholder="All but contracts"
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

      {processOptions.length > 0 && (
        <Picker
          label="Process"
          options={processOptions}
          selected={scope.process ? [scope.process] : []}
          onChange={(next) => setScope({ process: next[0] ?? '' })}
          multiple={false}
          placeholder="Any process"
          emptyText="No process packs loaded"
          width={300}
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
