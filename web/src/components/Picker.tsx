import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export type Option = { value: string; label: string; sub?: string; count?: number }

/**
 * Compact multi/single select with a search box. Built from ordinary controls —
 * the chart layer only asks that these sit in one row above the content.
 */
export function Picker({
  label,
  options,
  selected,
  onChange,
  multiple = true,
  placeholder = 'All',
  emptyText = 'Nothing to choose',
  width = 230,
  onSearch,
  loading,
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (next: string[]) => void
  multiple?: boolean
  placeholder?: string
  emptyText?: string
  width?: number
  onSearch?: (q: string) => void
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  useEffect(() => {
    if (onSearch) {
      const t = setTimeout(() => onSearch(query), 220)
      return () => clearTimeout(t)
    }
  }, [query, onSearch])

  const visible = useMemo(() => {
    if (onSearch || !query) return options
    const q = query.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q))
  }, [options, query, onSearch])

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`

  const toggle = (value: string) => {
    if (!multiple) {
      onChange(selected[0] === value ? [] : [value])
      setOpen(false)
      return
    }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="field" ref={box} style={{ position: 'relative', width }}>
      <label htmlFor={`picker-${label}`}>{label}</label>
      <button
        id={`picker-${label}`}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{ justifyContent: 'space-between', width: '100%', fontWeight: selected.length ? 650 : 500 }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
        >
          {summary}
        </span>
        <Chevron />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 5px)',
            left: 0,
            zIndex: 40,
            width: Math.max(width, 300),
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 9,
            boxShadow: '0 8px 26px rgba(0,0,0,0.16)',
            padding: 8,
          }}
        >
          <input
            type="search"
            autoFocus
            value={query}
            placeholder="Search…"
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <div className="checklist" style={{ border: 0, padding: 0, maxHeight: 300 }}>
            {loading && <div className="muted" style={{ padding: 8 }}>Loading…</div>}
            {!loading && visible.length === 0 && (
              <div className="muted" style={{ padding: 8 }}>
                {emptyText}
              </div>
            )}
            {visible.map((o) => (
              <label key={o.value} className="checkrow">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className="grow">
                  {o.label}
                  {o.sub && <span className="muted"> · {o.sub}</span>}
                </span>
                {o.count !== undefined && <span className="count">{o.count.toLocaleString()}</span>}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" className="ghost" onClick={() => onChange([])}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Select({
  label,
  value,
  onChange,
  children,
  width,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
  width?: number
}) {
  return (
    <div className="field" style={{ width }}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  )
}
