import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMeasure } from '../components/ui'

export const COLS = 12
export const ROW_H = 84
export const GAP = 12

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number }

const collides = (a: LayoutItem, b: LayoutItem) =>
  a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/**
 * Re-settle the layout around one pinned item: anything colliding with the pin
 * is pushed down, then everything (except the pin) floats back up as far as it
 * can. The same routine serves drag and resize.
 */
export function resolveLayout(items: LayoutItem[], pinnedId: string): LayoutItem[] {
  const pin = items.find((l) => l.i === pinnedId)
  if (!pin) return items

  const rest = items
    .filter((l) => l.i !== pinnedId)
    .map((l) => ({ ...l }))
    .sort((a, b) => a.y - b.y || a.x - b.x)

  const placed: LayoutItem[] = [{ ...pin }]
  for (const item of rest) {
    while (placed.some((p) => collides(item, p))) item.y += 1
    placed.push(item)
  }

  // Upward compaction, pin excluded, top rows first.
  const settled: LayoutItem[] = [placed[0]]
  for (const item of placed.slice(1).sort((a, b) => a.y - b.y || a.x - b.x)) {
    while (item.y > 0) {
      const candidate = { ...item, y: item.y - 1 }
      if (settled.some((p) => collides(candidate, p))) break
      item.y -= 1
    }
    settled.push(item)
  }
  return settled
}

export function compactAll(items: LayoutItem[]): LayoutItem[] {
  const sorted = items.map((l) => ({ ...l })).sort((a, b) => a.y - b.y || a.x - b.x)
  const settled: LayoutItem[] = []
  for (const item of sorted) {
    while (item.y > 0) {
      const candidate = { ...item, y: item.y - 1 }
      if (settled.some((p) => collides(candidate, p))) break
      item.y -= 1
    }
    settled.push(item)
  }
  return settled
}

export function nextFreeY(items: LayoutItem[]): number {
  return items.reduce((m, l) => Math.max(m, l.y + l.h), 0)
}

type DragState = {
  id: string
  mode: 'move' | 'resize'
  startClientX: number
  startClientY: number
  orig: LayoutItem
}

export type GridHandles = {
  onMoveDown: (e: React.PointerEvent) => void
  onResizeDown: (e: React.PointerEvent) => void
  dragging: boolean
}

/**
 * A 12-column drag/resize grid. Items snap live while dragging; neighbours
 * reflow around them. Pure pointer math — no drag library.
 */
export function DashGrid({
  layout,
  minSize,
  onChange,
  onCommit,
  render,
}: {
  layout: LayoutItem[]
  minSize: (id: string) => { w: number; h: number }
  onChange: (next: LayoutItem[]) => void
  onCommit: () => void
  render: (item: LayoutItem, handles: GridHandles) => ReactNode
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const [drag, setDrag] = useState<DragState | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const cellW = (Math.max(width, 320) - GAP * (COLS - 1)) / COLS

  useEffect(() => {
    if (!drag) return

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startClientX
      const dy = e.clientY - drag.startClientY
      const gx = Math.round(dx / (cellW + GAP))
      const gy = Math.round(dy / (ROW_H + GAP))
      const min = minSize(drag.id)
      const current = layoutRef.current
      const item = current.find((l) => l.i === drag.id)
      if (!item) return

      let next: LayoutItem
      if (drag.mode === 'move') {
        next = {
          ...item,
          x: Math.max(0, Math.min(COLS - item.w, drag.orig.x + gx)),
          y: Math.max(0, drag.orig.y + gy),
        }
      } else {
        next = {
          ...item,
          w: Math.max(min.w, Math.min(COLS - item.x, drag.orig.w + gx)),
          h: Math.max(min.h, drag.orig.h + gy),
        }
      }
      if (next.x === item.x && next.y === item.y && next.w === item.w && next.h === item.h) return
      onChange(resolveLayout(current.map((l) => (l.i === drag.id ? next : l)), drag.id))
    }

    const onUp = () => {
      setDrag(null)
      onCommit()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp, { once: true })
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
  }, [drag, cellW, minSize, onChange, onCommit])

  const begin = (id: string, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const orig = layoutRef.current.find((l) => l.i === id)
    if (!orig) return
    e.preventDefault()
    setDrag({ id, mode, startClientX: e.clientX, startClientY: e.clientY, orig: { ...orig } })
  }

  const rows = nextFreeY(layout)
  const heightPx = Math.max(1, rows) * ROW_H + Math.max(0, rows - 1) * GAP

  return (
    <div ref={ref} className="dash-grid" style={{ height: heightPx }}>
      {layout.map((item) => {
        const left = item.x * (cellW + GAP)
        const top = item.y * (ROW_H + GAP)
        const w = item.w * cellW + (item.w - 1) * GAP
        const h = item.h * ROW_H + (item.h - 1) * GAP
        const isDragging = drag?.id === item.i
        return (
          <div
            key={item.i}
            data-grid-id={item.i}
            className={`widget${isDragging ? ' dragging' : ''}`}
            style={{ transform: `translate(${left}px, ${top}px)`, width: w, height: h }}
          >
            {render(item, {
              onMoveDown: begin(item.i, 'move'),
              onResizeDown: begin(item.i, 'resize'),
              dragging: isDragging,
            })}
          </div>
        )
      })}
    </div>
  )
}
