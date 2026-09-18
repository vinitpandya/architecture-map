import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ScopeProvider, useScope } from './lib/scope'
import { DashboardsProvider, useDashboards } from './lib/dashboards'
import { relative } from './lib/format'
import { Modal } from './components/ui'
import { DashboardPage, DashboardsIndex } from './pages/Dashboards'
import { Explorer } from './pages/Explorer'
import { StatusReportPage } from './pages/StatusReport'
import { DiagramPage } from './pages/Diagram'
import { Settings } from './pages/Settings'

/** Fixed order and icons for the seeded built-in pages. */
const SYSTEM_NAV: { slug: string; icon: () => JSX.Element }[] = [
  { slug: 'overview', icon: IconGauge },
  { slug: 'flow', icon: IconFlow },
  { slug: 'initiatives', icon: IconTree },
  { slug: 'people', icon: IconPeople },
  { slug: 'insights', icon: IconHub },
  { slug: 'timeline', icon: IconClock },
]

function Shell() {

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          Jira Reports
        </div>

        <nav className="nav">
          <div className="nav-group-label">Reports</div>
          <ReportsNav />
          <PagesNav />
          <div className="nav-group-label" style={{ paddingTop: 14 }}>
            Status
          </div>
          <NavLink to="/status" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconReport />
            Weekly report
          </NavLink>
          <div className="nav-group-label" style={{ paddingTop: 14 }}>
            Tools
          </div>
          <NavLink to="/diagrams" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconDiagram />
            Diagrams
          </NavLink>
          <div className="nav-group-label" style={{ paddingTop: 14 }}>
            Data
          </div>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconCog />
            Connection & sync
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <SyncControl />
          <ThemeToggle />
          <DataFootnote />
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<SlugRedirect slug="overview" />} />
          <Route path="/overview" element={<SlugRedirect slug="overview" />} />
          <Route path="/flow" element={<SlugRedirect slug="flow" />} />
          <Route path="/initiatives" element={<SlugRedirect slug="initiatives" />} />
          <Route path="/people" element={<SlugRedirect slug="people" />} />
          <Route path="/insights" element={<SlugRedirect slug="insights" />} />
          <Route path="/timeline" element={<SlugRedirect slug="timeline" />} />
          <Route path="/dashboards" element={<DashboardsIndex />} />
          <Route path="/d/:id" element={<DashboardPage />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/status" element={<StatusReportPage />} />
          <Route path="/diagrams" element={<DiagramPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<SlugRedirect slug="overview" />} />
        </Routes>
      </main>
    </div>
  )
}

function SyncControl() {
  const { sync, startSync, cancelSync } = useScope()
  const running = sync?.running ?? false

  if (running) {
    return (
      <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
        <span className="pill" style={{ minWidth: 0 }}>
          <span className="spinner" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sync?.message ?? 'Syncing…'}
          </span>
        </span>
        <button type="button" className="ghost" style={{ flexShrink: 0 }} onClick={() => void cancelSync()}>
          Stop
        </button>
      </div>
    )
  }

  return (
    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
      <span>{sync?.last?.finishedAt ? `Synced ${relative(sync.last.finishedAt)}` : 'Never synced'}</span>
      <button
        type="button"
        className="ghost"
        title="Refresh local data"
        aria-label="Refresh local data"
        style={{ flexShrink: 0, padding: '3px 8px' }}
        onClick={() => void startSync('incremental')}
      >
        <RefreshIcon />
      </button>
    </div>
  )
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.2h-3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DataFootnote() {
  const { catalog } = useScope()
  if (!catalog?.ready) return <span>No local data yet</span>
  return (
    <span>
      {catalog.totals?.issues.toLocaleString()} issues cached locally
    </span>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'system'
  )

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme
      localStorage.removeItem('theme')
    } else {
      document.documentElement.dataset.theme = theme
      localStorage.setItem('theme', theme)
    }
  }, [theme])

  return (
    <div className="segmented" role="group" aria-label="Theme">
      {(['light', 'system', 'dark'] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)} style={{ padding: '4px 8px', fontSize: 12 }}>
          {t === 'system' ? 'Auto' : t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}

/** Seeded built-in pages, in fixed order, plus the interactive Explorer. */
function ReportsNav() {
  const { pages } = useDashboards()
  return (
    <>
      {SYSTEM_NAV.map(({ slug, icon: Icon }) => {
        const page = pages.find((p) => p.slug === slug)
        if (!page) return null
        return (
          <NavLink key={slug} to={`/d/${page.id}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon />
            {page.name}
          </NavLink>
        )
      })}
      <NavLink to="/explorer" className={({ isActive }) => (isActive ? 'active' : '')}>
        <IconList />
        Explorer
      </NavLink>
    </>
  )
}

/** Old bookmark paths (/overview, /flow, …) forward to the seeded page. */
function SlugRedirect({ slug }: { slug: string }) {
  const { pages, loaded } = useDashboards()
  if (!loaded) return null
  const page = pages.find((p) => p.slug === slug)
  return page ? <Navigate to={`/d/${page.id}`} replace /> : <Navigate to="/dashboards" replace />
}

function PagesNav() {
  const { pages, create, reorder } = useDashboards()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const custom = pages.filter((p) => !p.slug)

  const drop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return
    const ids = custom.map((p) => p.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    void reorder(ids)
  }

  return (
    <>
      <div className="nav-group-label" style={{ paddingTop: 14 }}>
        Pages
      </div>
      {custom.map((p) => (
        <NavLink
          key={p.id}
          to={`/d/${p.id}`}
          className={({ isActive }) => (isActive ? 'active' : '')}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', String(p.id))
            e.dataTransfer.effectAllowed = 'move'
            setDragId(p.id)
          }}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setOverId(p.id)
          }}
          onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault()
            setOverId(null)
            drop(p.id)
          }}
          style={
            overId === p.id && dragId != null && dragId !== p.id
              ? { outline: '2px dashed var(--accent)', outlineOffset: -2 }
              : undefined
          }
        >
          <IconGrid />
          {p.name}
        </NavLink>
      ))}
      <button type="button" className="nav-add" onClick={() => setCreating(true)}>
        <IconPlus />
        New page
      </button>
      {creating && (
        <NewPageModal
          onClose={() => setCreating(false)}
          onCreate={(name, withStarter) => {
            setCreating(false)
            void create(name, withStarter).then((d) => navigate(`/d/${d.id}`))
          }}
        />
      )}
    </>
  )
}

function NewPageModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string, withStarter: boolean) => void
}) {
  const [name, setName] = useState('')
  const [starter, setStarter] = useState(true)

  return (
    <Modal title="New page" onClose={onClose}>
      <form
        className="stack"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(name, starter)
        }}
      >
        <div className="field">
          <label htmlFor="np-name">Name</label>
          <input
            id="np-name"
            type="text"
            value={name}
            placeholder="e.g. Team health"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <label className="row" style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} />
          Start with the default layout
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Create page
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function App() {
  return (
    <ScopeProvider>
      <DashboardsProvider>
        <Shell />
      </DashboardsProvider>
    </ScopeProvider>
  )
}

/* ---------------------------------------------------------------- icons */

const S = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="12" width="4" height="9" rx="1.5" fill="var(--blue-250)" />
      <rect x="9" y="7" width="4" height="14" rx="1.5" fill="var(--blue-450)" />
      <rect x="16" y="3" width="4" height="18" rx="1.5" fill="var(--blue-650)" />
    </svg>
  )
}
function IconGauge() {
  return (
    <svg {...S}>
      <path d="M2.5 12a5.5 5.5 0 1 1 11 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 12l3-3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function IconFlow() {
  return (
    <svg {...S}>
      <path d="M1.8 12.5l3.4-4.2 3 2.4 5.9-6.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.8 14h12.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function IconTree() {
  return (
    <svg {...S}>
      <rect x="5.5" y="1.6" width="5" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.4" y="11" width="4.6" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="11" width="4.6" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5v3M3.7 11V8h8.6v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconPeople() {
  return (
    <svg {...S}>
      <circle cx="6" cy="5.4" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.8 13.6c0-2.3 1.9-3.7 4.2-3.7s4.2 1.4 4.2 3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.2 3.4a2.2 2.2 0 0 1 0 4.2M12 9.9c1.5.3 2.6 1.4 2.6 3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconList() {
  return (
    <svg {...S}>
      <path d="M5.4 4h8.2M5.4 8h8.2M5.4 12h8.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="2.6" cy="4" r="1" fill="currentColor" />
      <circle cx="2.6" cy="8" r="1" fill="currentColor" />
      <circle cx="2.6" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}
function IconGrid() {
  return (
    <svg {...S}>
      <rect x="1.8" y="1.8" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.8" y="1.8" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.8" y="8.8" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.8" y="8.8" width="5.4" height="5.4" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
function IconHub() {
  return (
    <svg {...S}>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="3" cy="3.4" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="3.4" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="3" cy="12.6" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="12.6" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.2 4.5L6.5 6.6M11.8 4.5L9.5 6.6M4.2 11.5L6.5 9.4M11.8 11.5L9.5 9.4" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg {...S}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6V8l2.4 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconReport() {
  return (
    <svg {...S}>
      <rect x="2.6" y="1.8" width="10.8" height="12.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 5h5.6M5.2 7.6h5.6M5.2 10.2h3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconDiagram() {
  return (
    <svg {...S}>
      <rect x="1.8" y="2" width="5" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.2" y="6.2" width="5" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.8" y="10.4" width="5" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.8 3.8h1.6v4.2h.8M6.8 12.2h1.6V8h.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
function IconPlus() {
  return (
    <svg {...S}>
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function IconCog() {
  return (
    <svg {...S}>
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8L3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
