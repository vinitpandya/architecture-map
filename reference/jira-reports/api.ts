export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText)
  return data as T
}

export const api = {
  get: <T,>(path: string, params?: Record<string, unknown>) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
    const q = qs.toString()
    return request<T>(`${path}${q ? `?${q}` : ''}`)
  },
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/* ------------------------------------------------------------------ types */

export type AuthStatus = {
  configured: boolean
  clientId: string | null
  hasSecret: boolean
  credentialSource: 'env' | 'settings' | null
  redirectUri: string
  scopes: string
  connected: boolean
  expiresAt: number | null
  grantedScopes: string | null
}

export type Site = { cloud_id: string; name: string; url: string; avatar: string | null }

export type Project = {
  id: string
  key: string
  name: string
  type_key: string
  style: string
  category: string | null
  lead: string | null
  issue_count: number
}

export type SyncStatus = {
  running: boolean
  phase: string | null
  message: string | null
  counts: Record<string, number> | null
  startedAt: number | null
  last: {
    id: number
    mode: string
    status: string
    startedAt: number
    finishedAt: number | null
    stats: { issues: number; changelogs: number; projects: number; issuesInDb: number } | null
    error: string | null
  } | null
}

export type Catalog = {
  ready: boolean
  levels?: { level: number; name: string; n: number }[]
  statuses?: { name: string; category: string; n: number }[]
  projects?: { key: string; name: string; type_key: string; n: number }[]
  totals?: { issues: number; newest: string | null }
  metrics?: { key: string; label: string }[]
  dimensions?: { key: string; label: string }[]
}

export type Root = {
  id: string
  key: string
  summary: string
  type_name: string
  hierarchy_level: number
  status_name: string
  status_category: string
  project_key: string
  project_type: string | null
  child_count: number
}

export type Summary = {
  metric: string
  total: number
  issues: number
  byCategory: Record<string, number>
  counts: Record<string, number>
  percentComplete: number
  percentInProgress: number
  points: number
  hours: number
  estimatedCoverage: number
  assignees: number
  unassigned: number
  throughput: { week: string; count: number; points: number }[]
}

export type CfdPoint = { date: string } & Record<string, number | string>
export type Cfd = { series: CfdPoint[]; keys: string[]; groupBy?: string; metric?: string; empty?: boolean }

export type TreeNode = {
  id: string
  key: string
  summary: string
  type: string
  level: number
  status: string
  category: string
  assignee: string | null
  assigneeId: string | null
  project: string
  points: number
  hours: number
  created: string
  resolved: string | null
  children: TreeNode[]
  rollup: {
    total: number
    done: number
    inProgress: number
    todo: number
    leaves: number
    leafDone: number
    percent: number
    countPercent: number
  }
}

export type SankeyData = {
  nodes: { id: string; name: string; column: number; dimension: string; value: number; key?: string }[]
  links: { source: string; target: string; value: number }[]
  dimensions: string[]
  metric?: string
  truncated?: boolean
}

export type Person = {
  id: string
  name: string
  avatar: string | null
  total: number
  done: number
  inProgress: number
  todo: number
  issues: number
  points: number
  hours: number
}

export type ChordData = {
  flow: string
  entities: { id: string; name: string; total: number }[]
  flows: { source: string; target: string; value: number }[]
  truncated: boolean
}

export type CycleTimeData = {
  groupBy: string
  rows: { name: string; n: number; p50: number; p90: number; min: number; max: number; mean: number }[]
}

export type GraphNode = {
  id: string
  key: string
  summary: string
  type: string
  level: number
  project: string
  category: string
  assignee: string | null
  leaves: number
  done: number
  points: number
}

export type GraphData = {
  nodes: GraphNode[]
  edges: { source: string; target: string; kind: 'parent' | 'link'; label?: string }[]
  storiesDropped: number
}

export type BurnupData = {
  metric?: string
  series: { date: string; scope: number; done: number; pct: number }[]
  weekly: { week: string; added: number; completed: number }[]
  empty?: boolean
}

export type TimelineNode = {
  id: string
  key: string
  summary: string
  type: string
  level: number
  project: string
  created: number
  initial: string
  transitions: { at: number; cat: string }[]
}

export type TimelineGraphData = {
  nodes: TimelineNode[]
  edges: { source: string; target: string; kind: 'parent' | 'link'; label?: string }[]
  storiesDropped: number
}

export type BreakdownData = {
  groupBy: string
  metric: string
  groups: number
  rows: {
    id: string
    name: string
    total: number
    done: number
    inProgress: number
    todo: number
    issues: number
  }[]
}

export type StatusMapping = {
  statuses: {
    name: string
    jiraCategory: string | null
    effective: string
    override: string | null
    count: number
  }[]
}

export type EpicDates = {
  epics: {
    key: string
    summary: string
    status: string
    category: string
    fields: Record<string, string | number>
  }[]
}

export type CrosstabData = {
  groupBy: string
  stackBy: string
  metric: string
  keys: string[]
  groups: number
  rows: {
    id: string
    name: string
    total: number
    issues: number
    values: Record<string, number>
  }[]
}

export type WidgetConfig = {
  i: string
  type: string
  title?: string
  x: number
  y: number
  w: number
  h: number
  options: Record<string, string>
}

/** Mirror of the client Scope shape (defined in lib/scope to avoid a cycle). */
export type ScopeData = {
  projects: string[]
  roots: string[]
  followLinks: boolean
  metric: string
  range: string
}

export type SavedFilter = { name: string; scope: ScopeData }

export type Dashboard = {
  id: number
  name: string
  /** Set for the seeded built-in pages; null for user-created ones. */
  slug: string | null
  layout: WidgetConfig[]
  /** This page's own filter row values; null falls back to the default scope. */
  scope: ScopeData | null
  updatedAt: number
}

export type DashboardMeta = {
  id: number
  name: string
  slug: string | null
  sortOrder?: number
  updatedAt?: number
}

export type Team = { id: number; name: string; sortOrder: number; archived: boolean }

export type StatusInitiative = {
  id: number
  title: string
  jiraKey: string | null
  archived: boolean
  teamIds: number[]
}

export type Rag = 'on-track' | 'at-risk' | 'off-track' | 'done' | 'paused'

export type StatusEntry = {
  id: number
  initiativeId: number
  /** The team section this update lives in; null lands in "General". */
  teamId: number | null
  title: string
  /** Effective epic link: the entry's own key, falling back to the workstream's. */
  jiraKey: string | null
  rag: Rag
  updateText: string
  targetDate: string | null
  prev: { rag: Rag; targetDate: string | null; updateText: string } | null
  progress: { pct: number; done: number; total: number } | null
  /** Tracked epic fields from Jira (report dates, HL estimation), if synced. */
  fields: Record<string, string | number> | null
}

export type StatusReport = { id: number; week: string; prevWeek: string | null; entries: StatusEntry[] }
export type StatusReportMeta = { id: number; week: string; entryCount: number }

export type IssueRow = {
  key: string
  summary: string
  type: string
  level: number
  status: string
  category: string
  assignee: string | null
  project: string
  points: number | null
  hours: number
  created: string
  updated: string
  resolved: string | null
  parent: string | null
}
