import { useMemo, useState, type ReactNode } from 'react'
import { full } from '../lib/format'

export type GridColumn<T> = {
  key: string
  label: ReactNode
  /** Sort/group value. Numbers sort numerically; strings by locale. */
  value: (row: T) => string | number | null | undefined
  render?: (row: T) => ReactNode
  align?: 'left' | 'right'
  wide?: boolean
  sortable?: boolean
  /** Defaults to true for text columns, false for right-aligned (numeric) ones. */
  groupable?: boolean
  /** Subtotal shown on group rows. Defaults to sum for numeric columns. */
  aggregate?: 'sum' | 'avg' | 'none'
  format?: (n: number) => string
  title?: (row: T) => string | undefined
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

type Prefs = { sort: Sort; group: string | null }

function loadPrefs(storageKey?: string): Prefs | null {
  if (!storageKey) return null
  try {
    const raw = localStorage.getItem(`jira-reports.grid.${storageKey}`)
    return raw ? (JSON.parse(raw) as Prefs) : null
  } catch {
    return null
  }
}

function savePrefs(storageKey: string | undefined, prefs: Prefs) {
  if (!storageKey) return
  try {
    localStorage.setItem(`jira-reports.grid.${storageKey}`, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

const compare = (a: unknown, b: unknown) => {
  if (a == null && b == null) return 0
  if (a == null) return 1 // blanks last
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * A sortable, groupable table. Click a header to sort (asc → desc → off);
 * pick a column in "Group by" to fold rows under collapsible group rows that
 * carry subtotals for numeric columns. Preferences persist per `storageKey`.
 */
export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  storageKey,
  defaultSort = null,
  maxHeight,
  emptyText = 'Nothing to show',
}: {
  rows: T[]
  columns: GridColumn<T>[]
  rowKey: (row: T, index: number) => string | number
  storageKey?: string
  defaultSort?: Sort
  maxHeight?: number
  emptyText?: string
}) {
  const initial = useMemo(() => loadPrefs(storageKey), [storageKey])
  const [sort, setSort] = useState<Sort>(initial?.sort ?? defaultSort)
  const [group, setGroup] = useState<string | null>(initial?.group ?? null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])
  const groupable = columns.filter((c) => c.groupable ?? c.align !== 'right')
  const groupCol = group ? colByKey.get(group) : undefined

  const updateSort = (key: string) => {
    const col = colByKey.get(key)
    if (!col || col.sortable === false) return
    const next: Sort =
      sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null
    setSort(next)
    savePrefs(storageKey, { sort: next, group })
  }

  const updateGroup = (key: string) => {
    const next = key || null
    setGroup(next)
    setCollapsed(new Set())
    savePrefs(storageKey, { sort, group: next })
  }

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = colByKey.get(sort.key)
    if (!col) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return rows
      .map((row, i) => ({ row, i, v: col.value(row) }))
      .sort((a, b) => compare(a.v, b.v) * dir || a.i - b.i)
      .map((x) => x.row)
  }, [rows, sort, colByKey])

  const groups = useMemo(() => {
    if (!groupCol) return null
    const map = new Map<string, T[]>()
    for (const row of sorted) {
      const v = groupCol.value(row)
      const label = v == null || v === '' ? '—' : String(v)
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(row)
    }
    const entries = [...map.entries()]
    // Group order follows the sort when sorting by the grouped column; else A→Z.
    if (!(sort && sort.key === groupCol.key)) {
      entries.sort((a, b) => compare(a[0], b[0]))
    }
    return entries
  }, [sorted, groupCol, sort])

  const aggregateOf = (col: GridColumn<T>, members: T[]): string | null => {
    const mode = col.aggregate ?? (col.align === 'right' ? 'sum' : 'none')
    if (mode === 'none') return null
    const nums = members.map((r) => col.value(r)).filter((v): v is number => typeof v === 'number')
    if (!nums.length) return null
    const total = nums.reduce((s, n) => s + n, 0)
    const n = mode === 'avg' ? total / nums.length : total
    return (col.format ?? full)(n)
  }

  const renderCell = (col: GridColumn<T>, row: T) => {
    const v = col.render ? col.render(row) : col.value(row)
    return v == null || v === '' ? '—' : v
  }

  const cellClass = (col: GridColumn<T>) =>
    [col.align === 'right' ? 'num' : '', col.wide ? 'wide' : ''].filter(Boolean).join(' ') || undefined

  if (!rows.length) return <p className="muted" style={{ fontSize: 12.5 }}>{emptyText}</p>

  const renderRow = (row: T, i: number) => (
    <tr key={rowKey(row, i)}>
      {columns.map((col) => (
        <td key={col.key} className={cellClass(col)} title={col.title?.(row)}>
          {renderCell(col, row)}
        </td>
      ))}
    </tr>
  )

  return (
    <div>
      {groupable.length > 0 && (
        <div className="grid-toolbar">
          <label>
            Group by{' '}
            <select value={group ?? ''} onChange={(e) => updateGroup(e.target.value)} aria-label="Group rows by">
              <option value="">— none —</option>
              {groupable.map((c) => (
                <option key={c.key} value={c.key}>
                  {typeof c.label === 'string' ? c.label : c.key}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {/* Only scroll internally when asked; inside widgets the body scrolls. */}
      <div className={maxHeight ? 'table-scroll' : undefined} style={maxHeight ? { maxHeight } : undefined}>
        <table className="data">
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort?.key === col.key
                const sortable = col.sortable !== false
                return (
                  <th
                    key={col.key}
                    className={sortable ? 'sortable' : undefined}
                    style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    onClick={sortable ? () => updateSort(col.key) : undefined}
                  >
                    {col.label}
                    {active && <span className="sort-mark">{sort!.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map(([label, members]) => {
                  const open = !collapsed.has(label)
                  return [
                    <tr
                      key={`g:${label}`}
                      className="group-row"
                      onClick={() =>
                        setCollapsed((s) => {
                          const next = new Set(s)
                          if (next.has(label)) next.delete(label)
                          else next.add(label)
                          return next
                        })
                      }
                    >
                      {columns.map((col, ci) => (
                        <td key={col.key} className={cellClass(col)}>
                          {ci === 0 ? (
                            <>
                              <span className="group-toggle">{open ? '▾' : '▸'}</span>
                              {label}
                              <span className="muted" style={{ fontWeight: 400 }}>{` · ${members.length}`}</span>
                            </>
                          ) : (
                            aggregateOf(col, members) ?? ''
                          )}
                        </td>
                      ))}
                    </tr>,
                    ...(open ? members.map((row, i) => renderRow(row, i)) : []),
                  ]
                })
              : sorted.map((row, i) => renderRow(row, i))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
