import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type Dashboard, type DashboardMeta } from './api'

/** Remembers the page last opened so /dashboards can land somewhere sensible. */
export const ACTIVE_KEY = 'jira-reports.dashboard'

export const newWidgetId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `w${Date.now()}${Math.floor(Math.random() * 1e6)}`)

type Ctx = {
  pages: DashboardMeta[]
  loaded: boolean
  refresh: () => Promise<DashboardMeta[]>
  create: (name: string, withStarter: boolean) => Promise<Dashboard>
  rename: (id: number, name: string) => Promise<void>
  remove: (id: number) => Promise<void>
  /** Persist a new sidebar order (ids in display order). */
  reorder: (ids: number[]) => Promise<void>
}

const DashboardsContext = createContext<Ctx | null>(null)

export function DashboardsProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<DashboardMeta[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await api.get<{ dashboards: DashboardMeta[] }>('/dashboards')
      setPages(d.dashboards)
      return d.dashboards
    } catch {
      return []
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (name: string, withStarter: boolean) => {
      // The server owns the default layout (Settings-configurable).
      const d = await api.post<Dashboard>('/dashboards', {
        name: name.trim() || 'New page',
        ...(withStarter ? { withDefault: true } : { layout: [] }),
      })
      localStorage.setItem(ACTIVE_KEY, String(d.id))
      await refresh()
      return d
    },
    [refresh]
  )

  const rename = useCallback(
    async (id: number, name: string) => {
      await api.put(`/dashboards/${id}`, { name })
      await refresh()
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: number) => {
      await api.del(`/dashboards/${id}`)
      if (localStorage.getItem(ACTIVE_KEY) === String(id)) localStorage.removeItem(ACTIVE_KEY)
      await refresh()
    },
    [refresh]
  )

  const reorder = useCallback(
    async (ids: number[]) => {
      // Optimistic: rearrange locally, then persist.
      setPages((prev) => {
        const rank = new Map(ids.map((id, i) => [id, i]))
        return [...prev].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
      })
      await api.put('/dashboards/order', { ids })
      await refresh()
    },
    [refresh]
  )

  return (
    <DashboardsContext.Provider value={{ pages, loaded, refresh, create, rename, remove, reorder }}>
      {children}
    </DashboardsContext.Provider>
  )
}

export function useDashboards() {
  const ctx = useContext(DashboardsContext)
  if (!ctx) throw new Error('useDashboards must be used inside DashboardsProvider')
  return ctx
}
