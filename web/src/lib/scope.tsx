import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, type IngestResult, type ScopeData, type Status } from './api'

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
  teams: [],
  includeExternal: true,
  process: '',
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
  /** What the last sweep or drop did, per file. Null until one has run. */
  ingestResults: IngestResult[] | null
  /** Ingest documents the browser holds, routed by shape exactly as the inbox is. */
  ingestFiles: (files: File[]) => Promise<void>
}

const ScopeContext = createContext<Ctx | null>(null)

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(loadScope)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<Status | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestError, setIngestError] = useState<string | null>(null)
  const [ingestResults, setIngestResults] = useState<IngestResult[] | null>(null)

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
      // The per-file results are the whole point of the button: a quarantined
      // file's ajv path is the one thing that tells the operator what to fix,
      // and it used to be discarded the moment it arrived.
      const { results } = await api.post<{ results: IngestResult[] }>('/ingest/sweep')
      setIngestResults(results ?? [])
      reload()
    } catch (err) {
      setIngestError(String((err as Error).message))
    } finally {
      setIngesting(false)
    }
  }, [reload])

  /**
   * The same thing for files the browser is holding, routed by the same rule
   * the inbox sweep uses — a `repo` is a manifest, a `pack` is a process pack,
   * anything else is not ingestable. Nothing is written to disk: the document
   * goes straight to the endpoint that validates it.
   */
  const ingestFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setIngesting(true)
      setIngestError(null)
      const results: IngestResult[] = []
      for (const file of files) {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(await file.text())
        } catch (err) {
          results.push({
            file: file.name,
            kind: null,
            ok: false,
            errors: [{ path: '/', message: `Not valid JSON: ${String((err as Error).message)}` }],
          })
          continue
        }
        const body = parsed as { repo?: unknown; pack?: unknown }
        const kind = body?.repo !== undefined ? 'manifest' : body?.pack !== undefined ? 'process-pack' : null
        if (!kind) {
          results.push({
            file: file.name,
            kind: null,
            ok: false,
            errors: [{ path: '/', message: 'Neither a scan manifest nor a process pack — no `repo` and no `pack`.' }],
          })
          continue
        }
        try {
          const res = await api.post<{ ok?: boolean; errors?: { path: string; message: string }[] }>(
            kind === 'manifest' ? '/ingest' : '/ingest/process-pack',
            parsed
          )
          results.push({ file: file.name, kind, ok: res.ok !== false, errors: res.errors ?? null })
        } catch (err) {
          results.push({
            file: file.name,
            kind,
            ok: false,
            errors: [{ path: '/', message: String((err as Error).message) }],
          })
        }
      }
      setIngestResults(results)
      setIngesting(false)
      reload()
    },
    [reload]
  )

  const params = useMemo(
    () => ({
      focus: scope.focus,
      depth: scope.depth,
      kinds: scope.kinds.join(','),
      repos: scope.repos.join(','),
      teams: scope.teams.join(','),
      includeExternal: String(scope.includeExternal),
      process: scope.process,
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
    ingestResults,
    ingestFiles,
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
