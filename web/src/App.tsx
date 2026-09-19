import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { ScopeProvider, useScope } from './lib/scope'
import { DashboardsProvider, useDashboards } from './lib/dashboards'
import { relative } from './lib/format'
import { Modal } from './components/ui'
import { PageView, PagesIndex } from './pages/Pages'
import { NodePage } from './pages/Node'
import { SearchPage } from './pages/Search'
import { ScanPage } from './pages/Scan'
import { ManifestsPage } from './pages/Manifests'
import { ProcessesPage } from './pages/Processes'
import { TeamsPage } from './pages/Teams'
import { TeamPage } from './pages/Team'
import { ProcessPage } from './pages/Process'

/** Fixed order and icons for the seeded built-in pages. */
const SYSTEM_NAV: { slug: string; icon: () => JSX.Element }[] = [
  { slug: 'map', icon: IconHub },
  { slug: 'estate', icon: IconGrid },
  { slug: 'messaging', icon: IconFlow },
  { slug: 'contracts', icon: IconContract },
  { slug: 'processes', icon: IconSteps },
  { slug: 'teams', icon: IconHandoff },
  { slug: 'health', icon: IconReport },
]

function Shell() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          Architecture Map
        </div>

        <nav className="nav">
          <div className="nav-group-label">Views</div>
          <SystemNav />
          <PagesNav />
          <div className="nav-group-label" style={{ paddingTop: 14 }}>
            Find
          </div>
          <NavLink to="/processes" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconTree />
            Processes
          </NavLink>
          <NavLink to="/teams" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconPeople />
            Teams
          </NavLink>
          <NavLink to="/search" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconList />
            Search
          </NavLink>
          <div className="nav-group-label" style={{ paddingTop: 14 }}>
            Data
          </div>
          <NavLink to="/scan" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconDiagram />
            Scan
          </NavLink>
          <NavLink to="/manifests" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconCog />
            Manifests
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <IngestControl />
          <ThemeToggle />
          <DataFootnote />
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<SlugRedirect slug="map" />} />
          <Route path="/pages" element={<PagesIndex />} />
          <Route path="/d/:id" element={<PageView />} />
          <Route path="/node" element={<NodePage />} />
          <Route path="/processes" element={<ProcessesPage />} />
          <Route path="/process" element={<ProcessPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/manifests" element={<ManifestsPage />} />
          <Route path="*" element={<SlugRedirect slug="map" />} />
        </Routes>
      </main>
    </div>
  )
}

function IngestControl() {
  const { ingesting, sweepInbox, status } = useScope()

  if (ingesting) {
    return (
      <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
        <span className="pill" style={{ minWidth: 0 }}>
          <span className="spinner" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Ingesting…
          </span>
        </span>
      </div>
    )
  }

  return (
    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
      <span>
        {status?.lastIngestAt ? `Ingested ${relative(Date.parse(status.lastIngestAt))}` : 'Nothing ingested'}
      </span>
      <button
        type="button"
        className="ghost"
        title="Sweep the inbox for new manifests"
        aria-label="Sweep the inbox for new manifests"
        style={{ flexShrink: 0, padding: '3px 8px' }}
        onClick={() => void sweepInbox()}
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
  const { status } = useScope()
  if (!status?.ready) return <span>No manifests ingested yet</span>
  const { services, edges } = status.counts
  return (
    <span>
      {services} services · {edges.toLocaleString()} links
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
        <button
          key={t}
          type="button"
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
          style={{ padding: '4px 8px', fontSize: 12 }}
        >
          {t === 'system' ? 'Auto' : t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}

/** Seeded built-in pages, in fixed order. */
function SystemNav() {
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
    </>
  )
}

function SlugRedirect({ slug }: { slug: string }) {
  const { pages, loaded } = useDashboards()
  if (!loaded) return null
  const page = pages.find((p) => p.slug === slug)
  return page ? <Navigate to={`/d/${page.id}`} replace /> : <Navigate to="/pages" replace />
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
            placeholder="e.g. Trading domain"
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
      <circle cx="12" cy="6" r="3" fill="var(--blue-650)" />
      <circle cx="5" cy="18" r="3" fill="var(--blue-450)" />
      <circle cx="19" cy="18" r="3" fill="var(--blue-250)" />
      <path d="M12 9v3M12 12L6.5 15.8M12 12l5.5 3.8" stroke="var(--blue-450)" strokeWidth="1.6" strokeLinecap="round" />
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
function IconFlow() {
  return (
    <svg {...S}>
      <path d="M1.8 4.5h8.4M1.8 11.5h8.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.2 2.6l2.6 1.9-2.6 1.9M10.2 9.6l2.6 1.9-2.6 1.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconContract() {
  return (
    <svg {...S}>
      <rect x="2.6" y="1.8" width="10.8" height="12.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.6 1.8" />
      <path d="M5.4 6h5.2M5.4 9h3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
/** The process tree: a hierarchy you can walk into. */
function IconTree() {
  return (
    <svg {...S}>
      <path d="M2.4 3h2.8M2.4 8h2.8M2.4 13h2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.6 3h6M7.6 8h6M7.6 13h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}
/** A handoff: one lane ending where another begins. */
function IconHandoff() {
  return (
    <svg {...S}>
      <path d="M1.8 4.6h5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 2.8l1.9 1.8L6 6.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.2 11.4H8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <path d="M10 9.6l-1.9 1.8L10 13.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  )
}

/** Teams: two people, because a team is the smallest unit that is not one. */
function IconPeople() {
  return (
    <svg {...S}>
      <circle cx="5.8" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.8 13.4c0-2.3 1.8-3.8 4-3.8s4 1.5 4 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11.4" cy="5.8" r="1.8" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path d="M10.2 10c2.1-.5 4 .9 4 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

/** The seeded Process map page: stages of a thing, in order. */
function IconSteps() {
  return (
    <svg {...S}>
      <rect x="1.6" y="2" width="4.4" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="6" y="6.3" width="4.4" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.4" y="10.6" width="4" height="3.4" rx="1" stroke="currentColor" strokeWidth="1.4" />
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
