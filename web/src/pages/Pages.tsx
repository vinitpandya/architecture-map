import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, type Dashboard, type WidgetConfig } from '../lib/api'
import { DEFAULT_SCOPE, useScope, type Scope } from '../lib/scope'
import { ACTIVE_KEY, newWidgetId, useDashboards } from '../lib/dashboards'
import { ScopeBar } from '../components/ScopeBar'
import { Banner, Empty, Modal } from '../components/ui'
import { DashGrid, compactAll, nextFreeY, type LayoutItem } from '../dashboard/Grid'
import {
  WIDGETS,
  WidgetBody,
  WidgetQuickBar,
  bodyHeight,
  defaultTitle,
  fieldChoices,
  widgetDef,
  type WidgetDef,
} from '../dashboard/registry'

/** /pages entry point: forward to the last-open (or first) page. */
export function PagesIndex() {
  const { pages, loaded } = useDashboards()
  if (!loaded) return null
  if (!pages.length) return <NoPagesYet />
  const stored = Number(localStorage.getItem(ACTIVE_KEY))
  const target = pages.find((p) => p.id === stored) ?? pages[0]
  return <Navigate to={`/d/${target.id}`} replace />
}

function NoPagesYet() {
  const { create } = useDashboards()
  const navigate = useNavigate()
  return (
    <div className="page">
      <Empty title="No pages yet">
        <button
          type="button"
          className="primary"
          onClick={() => void create('My page', true).then((d) => navigate(`/d/${d.id}`))}
        >
          Create one with starter widgets
        </button>
      </Empty>
    </div>
  )
}

export function PageView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { scope, replaceScope } = useScope()
  const { pages, rename, remove, refresh } = useDashboards()
  const [active, setActive] = useState<Dashboard | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<WidgetConfig | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [fullscreenId, setFullscreenId] = useState<string | null>(null)
  const saveTimer = useRef<number>()
  const scrollTo = useRef<string | null>(null)
  const scopeReady = useRef(false)
  const scopeSaveTimer = useRef<number>()
  const lastSavedScope = useRef('')

  useEffect(() => {
    let cancelled = false
    setMissing(false)
    setActive(null)
    setFullscreenId(null)
    scopeReady.current = false
    if (!id) return
    api
      .get<Dashboard>(`/dashboards/${id}`)
      .then((d) => {
        if (cancelled) return
        setActive(d)
        localStorage.setItem(ACTIVE_KEY, String(d.id))
        // Each page owns its filter row: load this page's saved scope.
        const pageScope = { ...DEFAULT_SCOPE, ...((d.scope ?? {}) as Partial<Scope>) }
        lastSavedScope.current = JSON.stringify(pageScope)
        replaceScope(pageScope)
        requestAnimationFrame(() => {
          if (!cancelled) scopeReady.current = true
        })
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [id, replaceScope])

  // Persist filter edits back onto the page (debounced, skipping the load itself).
  const pendingScopeSave = useRef<{ id: number; scope: Scope } | null>(null)
  useEffect(() => {
    if (!active || !scopeReady.current) return
    const serialized = JSON.stringify(scope)
    if (serialized === lastSavedScope.current) return
    window.clearTimeout(scopeSaveTimer.current)
    pendingScopeSave.current = { id: active.id, scope }
    scopeSaveTimer.current = window.setTimeout(() => {
      lastSavedScope.current = serialized
      pendingScopeSave.current = null
      api.put(`/dashboards/${active.id}`, { scope }).catch((err) => setError(String((err as Error).message)))
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  // Navigating away before the debounce fires must not lose the filter edit.
  useEffect(
    () => () => {
      window.clearTimeout(scopeSaveTimer.current)
      const p = pendingScopeSave.current
      if (p) {
        pendingScopeSave.current = null
        api.put(`/dashboards/${p.id}`, { scope: p.scope }).catch(() => undefined)
      }
    },
    []
  )

  const persist = useCallback((dashboard: Dashboard) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      api
        .put(`/dashboards/${dashboard.id}`, { layout: dashboard.layout })
        .catch((err) => setError(String((err as Error).message)))
    }, 500)
  }, [])

  const updateLayout = (positions: LayoutItem[]) => {
    if (!active) return
    const byId = new Map(positions.map((p) => [p.i, p]))
    setActive({
      ...active,
      layout: active.layout.map((w) => {
        const p = byId.get(w.i)
        return p ? { ...w, x: p.x, y: p.y, w: p.w, h: p.h } : w
      }),
    })
  }

  const commit = () => {
    if (active) persist(active)
  }

  const removePage = async () => {
    if (!active) return
    if (!window.confirm(`Delete the page "${active.name}" and its widgets?`)) return
    await remove(active.id)
    const rest = pages.filter((p) => p.id !== active.id)
    navigate(rest.length ? `/d/${rest[0].id}` : '/pages')
  }

  const resetPage = async () => {
    if (!active) return
    const what = active.slug ? 'its original layout' : 'the default layout'
    if (!window.confirm(`Reset "${active.name}" to ${what}? Your changes to this page are discarded.`)) return
    try {
      setActive(await api.post<Dashboard>(`/dashboards/${active.id}/reset`))
      await refresh()
    } catch (err) {
      setError(String((err as Error).message))
    }
  }

  const saveAsDefault = async () => {
    if (!active) return
    if (!window.confirm(`Make this page's layout the default for new pages?`)) return
    try {
      await api.put('/default-layout', { layout: active.layout })
    } catch (err) {
      setError(String((err as Error).message))
    }
  }

  const addWidget = (def: WidgetDef, preset?: Record<string, string>) => {
    if (!active) return
    const widget: WidgetConfig = {
      i: newWidgetId(),
      type: def.type,
      title: '',
      x: 0,
      y: nextFreeY(active.layout),
      w: def.w,
      h: def.h,
      options: {
        ...Object.fromEntries(
          def.fields
            .filter((f) => f.kind === 'select' && f.choices?.length)
            .map((f) => [f.key, f.choices![0].value])
        ),
        ...preset,
      },
    }
    const next = { ...active, layout: [...active.layout, widget] }
    setActive(next)
    persist(next)
    setAdding(false)
    // Straight into configuration; when that closes we scroll the widget into view.
    scrollTo.current = widget.i
    setEditing(widget)
  }

  const revealPending = () => {
    const widgetId = scrollTo.current
    if (!widgetId) return
    scrollTo.current = null
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-grid-id="${widgetId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const closeEditor = () => {
    setEditing(null)
    revealPending()
  }

  const removeWidget = (widgetId: string) => {
    if (!active) return
    const next = {
      ...active,
      layout: compactAll(active.layout.filter((w) => w.i !== widgetId)).map((p) => {
        const w = active.layout.find((l) => l.i === p.i)!
        return { ...w, x: p.x, y: p.y, w: p.w, h: p.h }
      }),
    }
    setActive(next)
    persist(next)
  }

  const patchWidget = (widgetId: string, patch: Record<string, string>) => {
    if (!active) return
    const next = {
      ...active,
      layout: active.layout.map((w) => (w.i === widgetId ? { ...w, options: { ...w.options, ...patch } } : w)),
    }
    setActive(next)
    persist(next)
  }

  const saveWidget = (widget: WidgetConfig) => {
    if (!active) return
    const next = { ...active, layout: active.layout.map((w) => (w.i === widget.i ? widget : w)) }
    setActive(next)
    persist(next)
    setEditing(null)
    revealPending()
  }

  const renamePage = async (name: string) => {
    setRenaming(false)
    if (!active || !name.trim() || name === active.name) return
    await rename(active.id, name.trim())
    setActive({ ...active, name: name.trim() })
  }

  if (missing) {
    return (
      <div className="page">
        <Empty title="That page no longer exists">
          <button type="button" onClick={() => navigate('/pages')}>
            Back to your pages
          </button>
        </Empty>
      </div>
    )
  }
  if (!active) return null

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{active.name}</h1>
          <p>
            Drag a card by its header, resize from the corner — everything is saved, and the filter
            row below belongs to this page.
          </p>
        </div>
        <div className="row">
          <button type="button" className="ghost" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button type="button" className="ghost" onClick={() => void resetPage()}>
            Reset layout
          </button>
          <button
            type="button"
            className="ghost"
            title="Use this layout for new pages"
            onClick={() => void saveAsDefault()}
          >
            Save as default
          </button>
          {!active.slug && (
            <button type="button" className="ghost danger" onClick={() => void removePage()}>
              Delete page
            </button>
          )}
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            + Add widget
          </button>
        </div>
      </div>

      <ScopeBar />

      {error && (
        <Banner
          kind="error"
          title="Page error"
          actions={
            <button type="button" className="ghost" onClick={() => setError(null)}>
              Dismiss
            </button>
          }
        >
          {error}
        </Banner>
      )}

      {active.layout.length === 0 ? (
        <Empty title="This page is empty">
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            + Add a widget
          </button>
        </Empty>
      ) : (
        <DashGrid
          layout={active.layout}
          minSize={(widgetId) => {
            const w = active.layout.find((l) => l.i === widgetId)
            const def = w ? widgetDef(w.type) : undefined
            return { w: def?.minW ?? 2, h: def?.minH ?? 2 }
          }}
          onChange={updateLayout}
          onCommit={commit}
          render={(item, handles) => {
            const widget = active.layout.find((w) => w.i === item.i)!
            return (
              <>
                <div className="widget-head" onPointerDown={handles.onMoveDown}>
                  <span className="widget-title">{widget.title || defaultTitle(widget)}</span>
                  {widget.w >= 4 && (
                    <WidgetQuickBar widget={widget} onPatch={(p) => patchWidget(widget.i, p)} />
                  )}
                  <span className="row" style={{ gap: 2, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="ghost widget-btn"
                      aria-label="Expand widget to full screen"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setFullscreenId(widget.i)}
                    >
                      ⛶
                    </button>
                    <button
                      type="button"
                      className="ghost widget-btn"
                      aria-label="Configure widget"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setEditing(widget)}
                    >
                      ⚙
                    </button>
                    <button
                      type="button"
                      className="ghost widget-btn"
                      aria-label="Remove widget"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeWidget(widget.i)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div className="widget-body" style={{ maxHeight: bodyHeight(widget.h) + 8 }}>
                  <WidgetBody widget={widget} />
                </div>
                <div className="resize-handle" onPointerDown={handles.onResizeDown} aria-hidden="true" />
              </>
            )
          }}
        />
      )}

      {adding && (
        <Modal title="Add a widget" onClose={() => setAdding(false)}>
          <div className="type-grid">
            {WIDGETS.filter((def) => !def.hidden).map((def) => (
              <button key={def.type} type="button" className="type-card" onClick={() => addWidget(def)}>
                <strong>{def.label}</strong>
                <span>{def.desc}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {editing && <WidgetEditor widget={editing} onSave={saveWidget} onClose={closeEditor} />}

      {renaming && (
        <Modal title="Rename page" onClose={() => setRenaming(false)}>
          <RenameForm initial={active.name} onSubmit={(name) => void renamePage(name)} />
        </Modal>
      )}

      {fullscreenId &&
        (() => {
          const w = active.layout.find((l) => l.i === fullscreenId)
          return w ? (
            <FullscreenWidget
              widget={w}
              onClose={() => setFullscreenId(null)}
              onEdit={() => setEditing(w)}
              onPatch={(patch) => patchWidget(w.i, patch)}
            />
          ) : null
        })()}
    </div>
  )
}

/**
 * A widget blown up to (almost) the whole viewport. The body re-renders with a
 * synthetic grid height sized to the screen, so content scales up; the header
 * keeps its quick controls so the widget stays editable without leaving.
 */
function FullscreenWidget({
  widget,
  onClose,
  onEdit,
  onPatch,
}: {
  widget: WidgetConfig
  onClose: () => void
  onEdit: () => void
  onPatch: (patch: Record<string, string>) => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  // Invert bodyHeight(): pick h so the body fills the overlay.
  const overlayBody = window.innerHeight * 0.92 - 96
  const bigH = Math.max(4, Math.round((overlayBody + 60 + 12) / 96))
  const fsWidget: WidgetConfig = { ...widget, w: 12, h: bigH }

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal fs" role="dialog" aria-label={widget.title || defaultTitle(widget)}>
        <div className="row" style={{ gap: 10, marginBottom: 10, flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>{widget.title || defaultTitle(widget)}</h2>
          <WidgetQuickBar widget={widget} onPatch={onPatch} />
          <button type="button" className="ghost widget-btn" aria-label="Configure widget" onClick={onEdit}>
            ⚙
          </button>
          <button type="button" className="ghost" style={{ flexShrink: 0 }} onClick={onClose}>
            Exit full screen ✕
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <WidgetBody widget={fsWidget} />
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ----------------------------------------------------------------- modals */

function RenameForm({ initial, onSubmit }: { initial: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(name)
      }}
      className="row"
    >
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ flex: 1 }} />
      <button type="submit" className="primary">
        Save
      </button>
    </form>
  )
}

function WidgetEditor({
  widget,
  onSave,
  onClose,
}: {
  widget: WidgetConfig
  onSave: (w: WidgetConfig) => void
  onClose: () => void
}) {
  const { status } = useScope()
  const repos = status?.repos.map((r) => r.repo) ?? []
  const def = widgetDef(widget.type)
  const [title, setTitle] = useState(widget.title ?? '')
  const [options, setOptions] = useState({ ...widget.options })

  if (!def) return null

  return (
    <Modal title={`Configure ${def.label.toLowerCase()}`} onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="wtitle">Title</label>
          <input
            id="wtitle"
            type="text"
            value={title}
            placeholder={defaultTitle(widget)}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {def.fields
          .filter((f) => !f.showIf || f.showIf(options))
          .map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`wf-${f.key}`}>{f.label}</label>
              {f.kind === 'select' ? (
                <select
                  id={`wf-${f.key}`}
                  value={options[f.key] ?? ''}
                  onChange={(e) => setOptions({ ...options, [f.key]: e.target.value })}
                >
                  {fieldChoices(f, repos).map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`wf-${f.key}`}
                  type="text"
                  value={options[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setOptions({ ...options, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}

        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Leave a field empty to inherit the filter row above the page.
        </p>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onSave({ ...widget, title: title.trim(), options })}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}
