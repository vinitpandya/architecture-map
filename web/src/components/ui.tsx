import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { pct } from '../lib/format'

/* ----------------------------------------------------------------- card */

export function Card({
  title,
  sub,
  actions,
  loading,
  children,
  style,
}: {
  title?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  loading?: boolean
  children: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <section className={`card${loading ? ' loading' : ''}`} style={style}>
      {(title || actions) && (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2>{title}</h2>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------ stat tile */

export function StatTile({
  label,
  value,
  detail,
  good,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  good?: boolean
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      {/* Proportional figures: tabular-nums makes display sizes look loose. */}
      <div className="value">{value}</div>
      {detail && <div className={`delta${good ? ' good' : ''}`}>{detail}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- meter */

/**
 * Completion meter. Fill and track ride the same blue ramp so state reads across
 * the whole bar; the numeric value is always rendered beside it, never
 * color-only.
 */
export function Meter({
  done,
  inProgress = 0,
  total,
  showLabel = true,
}: {
  done: number
  inProgress?: number
  total: number
  showLabel?: boolean
}) {
  const d = total > 0 ? (done / total) * 100 : 0
  const p = total > 0 ? (inProgress / total) * 100 : 0
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <div
        className="meter"
        style={{ flex: '1 1 auto', minWidth: 60 }}
        role="img"
        aria-label={`${pct(d)} done, ${pct(p)} in progress`}
      >
        <div className="fill" style={{ width: `${d}%` }} />
        <div className="fill progress" style={{ width: `${p}%` }} />
      </div>
      {showLabel && (
        <span className="mono muted" style={{ fontSize: 12, minWidth: 34, textAlign: 'right' }}>
          {pct(d)}
        </span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- tooltip */

export type TooltipRow = { name: string; value: string; color?: string }

export function Tooltip({
  x,
  y,
  title,
  rows,
  total,
}: {
  x: number
  y: number
  title: string
  rows: TooltipRow[]
  total?: { name: string; value: string }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ dx: 14, dy: 14 })

  // Flip toward the pointer when the card would run off the viewport.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setOffset({
      dx: x + 14 + r.width > window.innerWidth ? -r.width - 14 : 14,
      dy: y + 14 + r.height > window.innerHeight ? -r.height - 14 : 14,
    })
  }, [x, y, rows.length, title])

  return (
    <div ref={ref} className="tooltip" style={{ left: x + offset.dx, top: y + offset.dy }} role="status">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.name}>
          {r.color && <span className="tt-key" style={{ background: r.color }} />}
          {/* Values lead, names follow — the reader already has the series. */}
          <span className="tt-value">{r.value}</span>
          <span className="tt-name">{r.name}</span>
        </div>
      ))}
      {total && (
        <div className="tt-row tt-total">
          <span className="tt-value">{total.value}</span>
          <span className="tt-name">{total.name}</span>
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- legend */

export function Legend({
  items,
  hidden,
  onToggle,
  shape = 'rect',
}: {
  items: { id: string; label: string; color: string }[]
  hidden?: Set<string>
  onToggle?: (id: string) => void
  shape?: 'rect' | 'line'
}) {
  if (items.length < 2) return null
  return (
    <div className="legend">
      {items.map((it) => {
        const on = !hidden?.has(it.id)
        return (
          <button
            key={it.id}
            type="button"
            className="legend-item"
            aria-pressed={on}
            onClick={onToggle ? () => onToggle(it.id) : undefined}
            style={{ cursor: onToggle ? 'pointer' : 'default' }}
            disabled={!onToggle}
          >
            <span className={`swatch${shape === 'line' ? ' line' : ''}`} style={{ background: it.color }} />
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------- table view */

export function TableToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segmented" role="group" aria-label="View">
      <button type="button" aria-pressed={!on} onClick={() => onChange(false)}>
        Chart
      </button>
      <button type="button" aria-pressed={on} onClick={() => onChange(true)}>
        Table
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------- misc */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  // Portalled to <body>: rendered in place, an ancestor with its own stacking
  // context (the sticky sidebar, a transformed widget) would paint over it.
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function Banner({
  kind = 'info',
  title,
  children,
  actions,
}: {
  kind?: 'info' | 'warn' | 'error'
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className={`banner ${kind}`}>
      <div className="banner-body">
        <h3>{title}</h3>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}

/**
 * A card body the reader can drag taller or shorter (native bottom-right
 * handle). The chosen height persists per card, and the render-prop receives
 * the live height so the chart inside genuinely refills the space.
 */
export function ResizableBody({
  storageKey,
  defaultHeight,
  min = 160,
  max = 1100,
  children,
}: {
  storageKey: string
  defaultHeight: number
  min?: number
  max?: number
  children: (height: number) => ReactNode
}) {
  const key = `jira-reports.size.${storageKey}`
  const [height, setHeight] = useState<number>(() => {
    const stored = Number(localStorage.getItem(key))
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : defaultHeight
  })
  const initial = useRef(height)
  const live = useRef(height)
  live.current = height
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const h = Math.round(entries[0].contentRect.height)
      if (h && Math.abs(h - live.current) > 2) {
        setHeight(h)
        localStorage.setItem(key, String(h))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [key])

  return (
    <div
      ref={ref}
      className="resizable-body"
      style={{ height: initial.current, minHeight: min, maxHeight: max }}
    >
      {children(height)}
    </div>
  )
}

/** Measures the container so charts can be responsive without a fixed width. */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(720)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && Math.abs(w - width) > 1) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ref, width }
}

/** Re-render charts when the theme changes so CSS-var colors are re-read. */
export function useThemeVersion() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const bump = () => setV((n) => n + 1)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', bump)
    const obs = new MutationObserver(bump)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', bump)
      obs.disconnect()
    }
  }, [])
  return v
}
