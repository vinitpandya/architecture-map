import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, type ScopeData, type Status } from './api'

export type Scope = ScopeData

export const ALL_NODE_KINDS = [
  'service',
  'kafka.topic',
  'database',
  'cache',
  'endpoint',
  'contract',
  'external',
] as const

/** Contracts are opt-in: they multiply edge count and clutter the default view. */
export const DEFAULT_SCOPE: Scope = {
  focus: '',
  depth: '1',
  kinds: ['service', 'kafka.topic', 'database', 'cache', 'endpoint'],
  repos: [],
  includeExternal: true,
}

const STORAGE_KEY = 'architecture-map.scope'

function loadScope(): Scope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_SCOPE, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_SCOPE
}

type Ctx = {
  scope: Scope
  setScope: (patch: Partial<Scope>) => void
  /** Swap the whole scope at once — used when a page loads its own filter. */
  replaceScope: (next: Scope) => void
  resetScope: () => void
  /** Params every read endpoint accepts. */
  params: Record<string, string>
  /** Bumped whenever an ingest finishes or the user forces a reload. */
  revision: number
  reload: () => void
  status: Status | null
  refreshStatus: () => Promise<void>
  ingesting: boolean
  sweepInbox: () => Promise<void>
  ingestError: string | null
}

const ScopeContext = createContext<Ctx | null>(null)

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(loadScope)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<Status | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestError, setIngestError] = useState<string | null>(null)

  const setScope = useCallback((patch: Partial<Scope>) => {
    setScopeState((prev) => ({ ...prev, ...patch }))
  }, [])

  const replaceScope = useCallback((next: Scope) => setScopeState(next), [])
  const resetScope = useCallback(() => setScopeState(DEFAULT_SCOPE), [])
  const reload = useCallback(() => setRevision((r) => r + 1), [])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.get<Status>('/status'))
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus, revision])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scope))
    } catch {
      /* ignore */
    }
  }, [scope])

  const sweepInbox = useCallback(async () => {
    setIngesting(true)
    setIngestError(null)
    try {
      await api.post('/ingest/sweep')
      reload()
    } catch (err) {
      setIngestError(String((err as Error).message))
    } finally {
      setIngesting(false)
    }
  }, [reload])

  const params = useMemo(
    () => ({
      focus: scope.focus,
      depth: scope.depth,
      kinds: scope.kinds.join(','),
      repos: scope.repos.join(','),
      includeExternal: String(scope.includeExternal),
    }),
    [scope]
  )

  const value: Ctx = {
    scope,
    setScope,
    replaceScope,
    resetScope,
    params,
    revision,
    reload,
    status,
    refreshStatus,
    ingesting,
    sweepInbox,
    ingestError,
  }

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export function useScope() {
  const ctx = useContext(ScopeContext)
  if (!ctx) throw new Error('useScope must be used inside ScopeProvider')
  return ctx
}

/**
 * Fetch for the current scope. Previous data is held while a refetch is in
 * flight so widgets dim rather than collapsing into a skeleton.
 */
export function useQuery<T>(
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
