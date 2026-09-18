import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, type Catalog, type SyncStatus } from './api'

export type RangePreset = 'all' | '30d' | '90d' | '180d' | '365d'

export type Scope = {
  projects: string[]
  roots: string[]
  /** Set when the roots are Discovery ideas — they reach delivery work via issue links. */
  followLinks: boolean
  metric: 'count' | 'points' | 'timespent'
  range: RangePreset
  /** Limit to these status names (empty = all). */
  statuses: string[]
  /** Drop everything done, cancelled, closed, rejected or deleted. */
  excludeDone: boolean
  /** The "Report on" level driving the selection picker ('2', '1', 'idea', 'any'). */
  rootLevel: string
}

export const DEFAULT_SCOPE: Scope = {
  projects: [],
  roots: [],
  followLinks: false,
  metric: 'count',
  range: '90d',
  statuses: [],
  excludeDone: false,
  rootLevel: '2',
}

const STORAGE_KEY = 'jira-reports.scope'

function loadScope(): Scope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SCOPE, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_SCOPE
}

export function rangeStart(range: RangePreset): string | undefined {
  if (range === 'all') return undefined
  const days = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 }[range]
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

type Ctx = {
  scope: Scope
  setScope: (patch: Partial<Scope>) => void
  /** Swap the whole scope at once — used when a page loads its own filter. */
  replaceScope: (next: Scope) => void
  resetScope: () => void
  /** Params every report endpoint accepts. */
  params: Record<string, string>
  /** Bumped whenever a sync finishes or the user forces a reload. */
  revision: number
  reload: () => void
  catalog: Catalog | null
  refreshCatalog: () => Promise<void>
  sync: SyncStatus | null
  startSync: (mode: 'incremental' | 'full') => Promise<void>
  cancelSync: () => Promise<void>
  syncError: string | null
  siteUrl: string | null
}

const ScopeContext = createContext<Ctx | null>(null)

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(loadScope)
  const [revision, setRevision] = useState(0)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [siteUrl, setSiteUrl] = useState<string | null>(null)
  const wasRunning = useRef(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scope))
  }, [scope])

  const setScope = useCallback((patch: Partial<Scope>) => {
    setScopeState((s) => ({ ...s, ...patch }))
  }, [])

  const replaceScope = useCallback((next: Scope) => {
    setScopeState({ ...DEFAULT_SCOPE, ...next })
  }, [])

  const resetScope = useCallback(() => setScopeState(DEFAULT_SCOPE), [])
  const reload = useCallback(() => setRevision((r) => r + 1), [])

  const refreshCatalog = useCallback(async () => {
    try {
      const [cat, site] = await Promise.all([
        api.get<Catalog>('/catalog'),
        api.get<{ url: string | null }>('/site-url'),
      ])
      setCatalog(cat)
      setSiteUrl(site.url)
    } catch {
      setCatalog({ ready: false })
    }
  }, [])

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  // Poll only while a sync is in flight; one idle poll on mount seeds "last run".
  useEffect(() => {
    let timer: number | undefined
    let cancelled = false

    const tick = async () => {
      try {
        const s = await api.get<SyncStatus>('/sync/status')
        if (cancelled) return
        setSync(s)
        if (wasRunning.current && !s.running) {
          wasRunning.current = false
          if (s.last?.status === 'error') setSyncError(s.last.error)
          await refreshCatalog()
          setRevision((r) => r + 1)
        }
        if (s.running) {
          wasRunning.current = true
          timer = window.setTimeout(tick, 700)
        }
      } catch {
        /* server not up yet */
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [refreshCatalog, revision])

  const startSync = useCallback(async (mode: 'incremental' | 'full') => {
    setSyncError(null)
    try {
      await api.post('/sync', { mode })
      wasRunning.current = true
      setSync((s) => ({ ...(s ?? { last: null, counts: null, startedAt: null }), running: true, phase: 'starting', message: 'Starting…' } as SyncStatus))
      setRevision((r) => r + 1)
    } catch (err) {
      setSyncError(String((err as Error).message))
    }
  }, [])

  const cancelSync = useCallback(async () => {
    await api.post('/sync/cancel')
  }, [])

  const params = useMemo(() => {
    const p: Record<string, string> = { metric: scope.metric }
    if (scope.projects.length) p.projects = scope.projects.join(',')
    if (scope.roots.length) p.roots = scope.roots.join(',')
    if (scope.roots.length && scope.followLinks) p.followLinks = 'true'
    if (scope.statuses.length) p.statuses = scope.statuses.join(',')
    if (scope.excludeDone) p.excludeDone = 'true'
    const from = rangeStart(scope.range)
    if (from) p.from = from
    return p
  }, [scope])

  const value: Ctx = {
    scope,
    setScope,
    replaceScope,
    resetScope,
    params,
    revision,
    reload,
    catalog,
    refreshCatalog,
    sync,
    startSync,
    cancelSync,
    syncError,
    siteUrl,
  }

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export function useScope() {
  const ctx = useContext(ScopeContext)
  if (!ctx) throw new Error('useScope must be used inside ScopeProvider')
  return ctx
}

/**
 * Fetch a report for the current scope. Previous data is held while a refetch is
 * in flight so charts dim rather than collapsing into a skeleton.
 */
export function useReport<T>(
  path: string | null,
  extra?: Record<string, unknown>
): { data: T | null; loading: boolean; error: string | null } {
  const { params, revision } = useScope()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = JSON.stringify([path, params, extra, revision])

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setLoading(true)
    api
      .get<T>(path, { ...params, ...extra })
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error).message))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, loading, error }
}
