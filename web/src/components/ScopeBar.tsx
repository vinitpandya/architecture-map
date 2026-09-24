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
  const [more, setMore] = useState(0)
  const [chosen, setChosen] = useState<GraphNode | null>(null)
  const [nodeQuery, setNodeQuery] = useState('')
  const [processes, setProcesses] = useState<Process[]>([])
  const [loading, setLoading] = useState(false)

  /* The focus picker searches the whole estate, not just what is on screen —
     and it searches it on the SERVER. Filtering a fetched page in the browser
     is only searching the estate while the estate fits in one page, and on
     anything real it does not: the first 500 rows came back ordered by kind,
     which sorts `service` last of the seven, so the picker whose whole job is
     to find a service offered none of them. */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<{ nodes: GraphNode[]; total: number }>('/nodes', { limit: 200, q: nodeQuery })
      .then((d) => {
        if (cancelled) return
        setNodes(d.nodes)
        setMore(Math.max(0, (d.total ?? d.nodes.length) - d.nodes.length))
      })
      .catch(() => !cancelled && setNodes([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [status?.lastIngestAt, nodeQuery])

  /* What is focused may be outside whatever the search last returned, and a
     picker that cannot name its own selection reads as though nothing is
     selected. Fetched once per focus and kept. */
  useEffect(() => {
    let cancelled = false
    if (!scope.focus) {
      setChosen(null)
      return
    }
    if (chosen?.id === scope.focus) return
    api
      .get<{ node: GraphNode }>('/node', { id: scope.focus })
      .then((d) => !cancelled && setChosen(d.node))
      .catch(() => !cancelled && setChosen(null))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.focus])

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

  const focusOptions: Option[] = [
    // The selection first, and never twice: it may be outside what the last
    // search returned, and dropping it would unname it.
    ...(chosen && !nodes.some((n) => n.id === chosen.id) ? [chosen] : []),
    ...nodes,
  ].map((n) => ({
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
  // Off the nodes already loaded for the focus picker, so the filter row makes
  // no request of its own — and so it offers exactly the teams that own
  // something on the map rather than the whole org chart.
  const teamOptions: Option[] = [
    ...new Map(
      nodes
        .filter((n) => n.teamId)
        .map((n) => [n.teamId!, { value: n.teamId!, label: n.teamName ?? n.teamId! }])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label))

  // Indented by level, because the tree is the point: picking a level 1 gives
  // the whole of it, picking a level 2 narrows to that stage.
  const processOptions: Option[] = processes.map((p) => ({
    // `<pack>#<code>`: a code alone no longer names one process, and two packs
    // numbering from 1 would otherwise put two identical rows in this list.
    value: `${p.pack}#${p.code}`,
    label: `${'\u2003'.repeat(p.level - 1)}${displayCode(p.code)} ${p.name}`,
    sub: p.level === 1 ? p.pack : (p.owner ?? undefined),
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
        emptyText={nodeQuery ? `Nothing matches “${nodeQuery}”` : 'Nothing ingested yet'}
        width={280}
        onSearch={setNodeQuery}
        loading={loading}
        footer={more > 0 ? `${more} more — type to narrow` : undefined}
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

      {teamOptions.length > 0 && (
        <Picker
          label="Teams"
          options={teamOptions}
          selected={scope.teams}
          onChange={(teams) => setScope({ teams })}
          placeholder="All teams"
          width={190}
        />
      )}

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
