import { useCallback, useEffect, useState } from 'react'
import { api, type Root, type SavedFilter } from '../lib/api'
import { useScope, type Scope } from '../lib/scope'
import { Picker, Select, type Option } from './Picker'

const LEVELS = [
  { value: '2', label: 'Initiatives' },
  { value: '1', label: 'Epics' },
  { value: 'idea', label: 'Ideas (Discovery)' },
  { value: 'any', label: 'Anything' },
]

/**
 * The filter row. Each page renders its own; the values scope every chart on
 * that page. Named filters are saved server-side and shared between pages.
 */
export function ScopeBar() {
  const { scope, setScope, replaceScope, catalog } = useScope()
  const level = scope.rootLevel || '2'
  const [roots, setRoots] = useState<Root[]>([])
  const [rootQuery, setRootQuery] = useState('')
  const [loadingRoots, setLoadingRoots] = useState(false)
  const [filters, setFilters] = useState<SavedFilter[]>([])
  const [activeFilter, setActiveFilter] = useState('')

  const loadFilters = useCallback(
    () =>
      api
        .get<{ filters: SavedFilter[] }>('/filters')
        .then((d) => setFilters(d.filters))
        .catch(() => undefined),
    []
  )
  useEffect(() => {
    void loadFilters()
  }, [loadFilters])

  const applyFilter = (name: string) => {
    setActiveFilter(name)
    const f = filters.find((x) => x.name === name)
    if (f) replaceScope(f.scope as Scope)
  }

  const saveFilter = async () => {
    const name = window.prompt('Save current filter as…', activeFilter || '')?.trim()
    if (!name) return
    const d = await api.post<{ filters: SavedFilter[] }>('/filters', { name, scope })
    setFilters(d.filters)
    setActiveFilter(name)
  }

  const deleteFilter = async () => {
    if (!activeFilter) return
    if (!window.confirm(`Delete the saved filter "${activeFilter}"?`)) return
    const d = await api.del<{ filters: SavedFilter[] }>(`/filters/${encodeURIComponent(activeFilter)}`)
    setFilters(d.filters)
    setActiveFilter('')
  }

  useEffect(() => {
    let cancelled = false
    setLoadingRoots(true)
    api
      .get<{ roots: Root[] }>('/roots', { level, q: rootQuery, limit: 200 })
      .then((d) => !cancelled && setRoots(d.roots))
      .catch(() => !cancelled && setRoots([]))
      .finally(() => !cancelled && setLoadingRoots(false))
    return () => {
      cancelled = true
    }
  }, [level, rootQuery, catalog])

  const projectOptions: Option[] = (catalog?.projects ?? []).map((p) => ({
    value: p.key,
    label: `${p.key} · ${p.name}`,
    count: p.n,
  }))

  const rootOptions: Option[] = roots.map((r) => ({
    value: r.key,
    label: `${r.key} ${r.summary}`,
    sub: r.child_count ? `${r.child_count} children` : r.type_name,
  }))

  return (
    <div className="scopebar">
      <Picker
        label="Projects"
        options={projectOptions}
        selected={scope.projects}
        onChange={(v) => setScope({ projects: v })}
        placeholder="All projects"
        emptyText="Sync a project first"
        width={240}
      />

      <Select label="Report on" value={level} onChange={(v) => setScope({ rootLevel: v })} width={150}>
        {LEVELS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </Select>

      <Picker
        label="Selection"
        options={rootOptions}
        selected={scope.roots}
        onChange={(v) => setScope({ roots: v, followLinks: level === 'idea' })}
        placeholder="Whole projects"
        emptyText="Nothing at this level yet"
        width={280}
        onSearch={setRootQuery}
        loading={loadingRoots}
      />

      <Select
        label="Measure"
        value={scope.metric}
        onChange={(v) => setScope({ metric: v as typeof scope.metric })}
        width={132}
      >
        <option value="count">Issue count</option>
        <option value="points">Story points</option>
        <option value="timespent">Time logged</option>
      </Select>

      <Select
        label="Window"
        value={scope.range}
        onChange={(v) => setScope({ range: v as typeof scope.range })}
        width={124}
      >
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="180d">Last 180 days</option>
        <option value="365d">Last year</option>
        <option value="all">All time</option>
      </Select>

      <Picker
        label="States"
        options={(catalog?.statuses ?? []).map((s) => ({
          value: s.name,
          label: s.name,
          sub: s.category === 'done' ? 'Done' : s.category === 'indeterminate' ? 'In progress' : 'To do',
          count: s.n,
        }))}
        selected={scope.statuses}
        onChange={(v) => setScope({ statuses: v })}
        placeholder="All states"
        emptyText="No statuses yet"
        width={190}
      />

      <div className="field">
        <label>Completed</label>
        <button
          type="button"
          className="pill"
          aria-pressed={scope.excludeDone}
          style={
            scope.excludeDone
              ? { color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 600 }
              : undefined
          }
          onClick={() => setScope({ excludeDone: !scope.excludeDone })}
          title="Hide everything done, cancelled, closed, rejected or deleted"
        >
          {scope.excludeDone ? 'Hidden ✓' : 'Shown'}
        </button>
      </div>

      <div className="field">
        <label>Saved filters</label>
        <div className="row" style={{ gap: 4 }}>
          <select
            value={activeFilter}
            onChange={(e) => applyFilter(e.target.value)}
            aria-label="Load a saved filter"
            style={{ maxWidth: 150 }}
          >
            <option value="">Load…</option>
            {filters.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="button" className="ghost" title="Save current filter" onClick={() => void saveFilter()}>
            Save
          </button>
          {activeFilter && (
            <button
              type="button"
              className="ghost danger"
              title="Delete this saved filter"
              aria-label="Delete this saved filter"
              onClick={() => void deleteFilter()}
            >
              ✕
            </button>
          )}
        </div>
      </div>

    </div>
  )
}
