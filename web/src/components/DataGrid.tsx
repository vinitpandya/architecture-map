import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { full } from '../lib/format'
import { SearchBox } from './SearchBox'

export type GridColumn<T> = {
  key: string
  label: ReactNode
  /** Sort/group/search value. Numbers sort numerically; strings by locale. */
  value: (row: T) => string | number | null | undefined
  render?: (row: T) => ReactNode
  /** Extra text the search reads, for a cell that shows more than its value —
   *  a count whose cell lists the things counted. */
  search?: (row: T) => string
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
    const raw = localStorage.getItem(`architecture-map.grid.${storageKey}`)
    return raw ? (JSON.parse(raw) as Prefs) : null
  } catch {
    return null
  }
}

// A widget blown up to full screen is a second copy of the same grid, mounted
// while the tile stays mounted underneath; both carry the widget's key. Each
// read its preferences once, so a sort chosen in the overlay would be gone
// when it closed and overwritten by the tile's next click. Saving announces
// the change and every grid with that key adopts it.
const PREFS_EVENT = 'architecture-map:grid-prefs'

function savePrefs(storageKey: string | undefined, prefs: Prefs) {
  if (!storageKey) return
  try {
    localStorage.setItem(`architecture-map.grid.${storageKey}`, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: { storageKey, prefs } }))
}

const compare = (a: unknown, b: unknown) => {
  if (a == null && b == null) return 0
  if (a == null) return 1 // blanks last
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * A searchable, sortable, groupable table. Type in the toolbar to keep only
 * the rows with a cell containing the text; click a header to sort
 * (asc → desc → off); pick a column in "Group by" to fold rows under
 * collapsible group rows that carry subtotals for numeric columns. Sort and
 * group persist per `storageKey`; the search does not, because a filter that
 * survives a reload reads as missing data.
 */
export function DataGrid<T>({
  rows,
  columns,
  rowKey,
  rowClass,
  storageKey,
  defaultSort = null,
  maxHeight,
  emptyText = 'Nothing to show',
}: {
  rows: T[]
  columns: GridColumn<T>[]
  rowKey: (row: T, index: number) => string | number
  /** A class for a row that reads differently — a dimmed context row. */
  rowClass?: (row: T) => string | undefined
  storageKey?: string
  defaultSort?: Sort
  maxHeight?: number
  emptyText?: string
}) {
  // A widget's columns change with its options while its key does not — a
  // list of services has a Team column, the same list of topics does not —
  // so a remembered sort or grouping is honoured only while its column exists.
  const has = (key: string | null | undefined) => !!key && columns.some((c) => c.key === key)
  const initial = useMemo(() => loadPrefs(storageKey), [storageKey])
  const [sort, setSort] = useState<Sort>(has(initial?.sort?.key) ? initial!.sort : defaultSort)
  const [group, setGroup] = useState<string | null>(has(initial?.group) ? initial!.group : null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!storageKey) return
    const adopt = (e: Event) => {
      const { storageKey: key, prefs } = (e as CustomEvent<{ storageKey: string; prefs: Prefs }>).detail
      if (key !== storageKey) return
      setSort(has(prefs.sort?.key) ? prefs.sort : null)
      setGroup((g) => {
        const next = has(prefs.group) ? prefs.group : null
        if (g !== next) setCollapsed(new Set())
        return next
      })
    }
    window.addEventListener(PREFS_EVENT, adopt)
    return () => window.removeEventListener(PREFS_EVENT, adopt)
  }, [storageKey, columns]) // `has` reads the columns of the render that adopts

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

  // The search reads the same value the sort does, across every column, so a
  // row is found by whatever it can be ordered by: an id under a link, a
  // number, a confidence. What a cell renders is not consulted; a column whose
  // cell shows more than its value says so with `search`.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      columns.some((col) => {
        const v = col.value(row)
        if (v != null && String(v).toLowerCase().includes(q)) return true
        return !!col.search && col.search(row).toLowerCase().includes(q)
      })
    )
  }, [rows, query, columns])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = colByKey.get(sort.key)
    if (!col) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return filtered
      .map((row, i) => ({ row, i, v: col.value(row) }))
      .sort((a, b) => compare(a.v, b.v) * dir || a.i - b.i)
      .map((x) => x.row)
  }, [filtered, sort, colByKey])

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
    <tr key={rowKey(row, i)} className={rowClass?.(row)}>
      {columns.map((col) => (
        <td key={col.key} className={cellClass(col)} title={col.title?.(row)}>
          {renderCell(col, row)}
        </td>
      ))}
    </tr>
  )

  return (
    <div className="data-grid">
      <div className="grid-toolbar">
        <SearchBox
          query={query}
          onChange={setQuery}
          shown={filtered.length}
          total={rows.length}
          noun="rows"
          label="Search rows"
        />
        {groupable.length > 0 && (
          <label>
            Group by{' '}
            <select value={group ?? ''} onChange={(e) => updateGroup(e.target.value)}>
              <option value="">— none —</option>
              {groupable.map((c) => (
                <option key={c.key} value={c.key}>
                  {typeof c.label === 'string' ? c.label : c.key}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
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
                  >
                    {/* A real button, so the keyboard can sort too; and an idle
                        mark on every one, so a column reads as sortable before
                        anyone has sorted by it. */}
                    {sortable ? (
                      <button type="button" className="sort" onClick={() => updateSort(col.key)}>
                        {col.label}
                        <SortMark dir={active ? sort!.dir : 'idle'} />
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr className="no-match">
                <td colSpan={columns.length} className="muted">
                  No rows match “{query.trim()}”
                </td>
              </tr>
            ) : groups ? (
              groups.map(([label, members]) => {
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
            ) : (
              sorted.map((row, i) => renderRow(row, i))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ icons */

/** Two stacked chevrons; the one for the active direction is filled in. A
 *  fixed 9×9 box, so the header does not shift as a column goes idle → asc →
 *  desc the way glyphs from a fallback font would make it. */
function SortMark({ dir }: { dir: 'asc' | 'desc' | 'idle' }) {
  const up = dir === 'asc' ? 1 : 0.35
  const down = dir === 'desc' ? 1 : 0.35
  return (
    <svg
      className={dir === 'idle' ? 'sort-mark idle' : 'sort-mark'}
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 0.5 L8 4 H1 Z" fill="currentColor" opacity={dir === 'idle' ? 1 : up} />
      <path d="M4.5 8.5 L1 5 H8 Z" fill="currentColor" opacity={dir === 'idle' ? 1 : down} />
    </svg>
  )
}
