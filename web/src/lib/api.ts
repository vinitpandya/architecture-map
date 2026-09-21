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
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
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

export type NodeKind =
  | 'service'
  | 'kafka.topic'
  | 'database'
  | 'cache'
  | 'endpoint'
  | 'contract'
  | 'external'

export type EdgeKind =
  | 'kafka.produce'
  | 'kafka.consume'
  | 'db.read'
  | 'db.write'
  | 'db.owns'
  | 'cache.read'
  | 'cache.write'
  | 'http.call'
  | 'http.expose'
  | 'depends.on'
  | 'topic.schema'

export type GraphNode = {
  id: string
  kind: NodeKind
  name: string
  description: string | null
  engine: string | null
  method: string | null
  path: string | null
  contractType: string | null
  language: string | null
  team: string | null
  ownerRepo: string | null
  orphan: boolean
  /** The resolved team — a topic's from its producer, an endpoint's from its
   *  exposer. `team` is what the scan wrote; this is what joins. */
  teamId?: string | null
  teamName?: string | null
  /** Where the team came from: the manifest, an owner, or a human correction. */
  teamVia?: 'scan' | 'inherited' | 'override' | null
  degree?: number
  hidden?: boolean
  confirmed?: boolean
}

export type GraphEdge = {
  id: string
  from: string
  to: string
  kind: EdgeKind
  contractId: string | null
  description: string | null
  confidence: 'high' | 'medium' | 'low'
  repo: string
}

export type GraphData = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** The process the graph was restricted to, when one was asked for. */
  process?: string | null
}

export type Evidence = {
  id: number
  subject_kind: string
  subject_id: string
  repo: string
  file: string
  line: number
  end_line: number | null
  snippet: string
}

export type Status = {
  ready: boolean
  counts: {
    services: number
    topics: number
    databases: number
    caches: number
    contracts: number
    endpoints: number
    externals: number
    orphans: number
    edges: number
    unresolved: number
    drift: number
    driftWarn: number
    quarantined: number
    processes: number
    processLeaves: number
    processPacks: number
    quarantinedPacks: number
  }
  teams: { total: number; registered: number; unregistered: number; departments: number }
  handoffs: { total: number; crossTeam: number; undocumented: number }
  coverage: { covered: number; total: number }
  driftByKind: Record<string, number>
  repos: {
    repo: string
    commit: string | null
    branch: string | null
    scannedAt: string | null
    ingestedAt: string | null
    producer: string | null
  }[]
  lastIngestAt: string | null
}

export type ContractBinding = { contract_id: string; service_id: string; version: string | null }

export type NodeDetail = {
  node: GraphNode
  out: GraphEdge[]
  in: GraphEdge[]
  evidence: Evidence[]
  /** The business processes that run through this component, deepest first. */
  processes: ProcessTouch[]
  /** Citations behind each edge on this page, keyed by edge id. */
  edgeEvidence: Record<string, Evidence[]>
  /** For a contract its own bindings, for a service its own, for a topic the
   *  bindings of whatever contract it carries — which is where skew shows. */
  bindings: ContractBinding[]
  /** Edges that name this node as the payload they carry. */
  viaContract: GraphEdge[]
  neighbours: GraphNode[]
  drift: DriftFinding[]
}

/* ----------------------------------------------------------- layer B */

export type ProcessSource = {
  kind?: string
  url?: string
  title?: string
  owner?: string
  asOf?: string
}

/**
 * One process at any level. A level 1 and a level 3 are the same shape — they
 * differ only in how much they decompose and whether they name a component.
 */
export type Process = {
  id: string
  /** `2.1.1`, without its `L`. The hierarchy and the order both live here. */
  code: string
  level: number
  parentId: string | null
  name: string
  description: string | null
  owner: string | null
  actor: string | null
  trigger: string | null
  outcome: string | null
  optional: boolean
  notes: string | null
  tags: string[]
  source: ProcessSource | null
  packId: number
  node: string | null
  /** Kept verbatim whether or not it resolved; `id` is null when it did not. */
  edge: { id: string | null; from: string; kind: EdgeKind; to: string } | null
  childCount: number
  componentCount: number
  /** What this process names that the map does not have. Shown, never hidden. */
  unresolved: { node: boolean; edge: boolean; edgeFrom: boolean; edgeTo: boolean }
  /** The resolved team, and whether the process named it or inherited it. */
  teamId?: string | null
  teamVia?: 'owner' | 'inherited' | null
}

export type ProcessTouch = {
  id: string
  code: string
  name: string
  level: number
  owner: string | null
  via: 'node' | 'interaction' | 'touches' | 'exposes' | 'rollup'
}

export type ProcessComponent = GraphNode & { via: ProcessTouch['via'] }

export type ProcessDetail = {
  process: Process
  ancestors: Process[]
  children: Process[]
  descendants: Process[]
  components: ProcessComponent[]
  edges: (GraphEdge & { via: 'interaction' | 'rollup' })[]
  services: ProcessComponent[]
  /** Handoffs out of, into, and entirely inside this process. */
  links: { out: Handoff[]; in: Handoff[]; inside: Handoff[] }
  teams: TeamReach[]
  drift: DriftFinding[]
  pack: ProcessPack | null
}

export type ProcessPack = {
  id: number
  pack: string
  name: string | null
  description: string | null
  authored_at: string | null
  ingested_at?: string
  prompt_version?: string | null
  producer_kind?: string | null
  producer_detail?: string | null
  source: ProcessSource | null
  source_file?: string | null
  status?: 'active' | 'superseded' | 'quarantined'
  errors?: { path: string; message: string }[] | null
  processes?: number
}

/**
 * What one document did on its way in, whether it arrived through the inbox or
 * was dropped on the Scan page. `errors` is ajv's, already explained.
 */
export type IngestResult = {
  file: string
  kind: 'manifest' | 'process-pack' | null
  ok: boolean
  errors?: { path: string; message: string }[] | null
  repo?: string
  pack?: string
  counts?: Record<string, number>
}

/* ------------------------------------------------------- layer C */

export type Department = { id: string; name: string; description: string | null }

export type Team = {
  id: string
  name: string
  department: { id: string; name: string } | null
  description: string | null
  contact: string | null
  /** In teams.json. False means the data mentions it and the registry does not. */
  registered: boolean
  /** The most authoritative thing that produced the id. */
  source: 'registry' | 'component' | 'process'
  /** Every other spelling that resolves here, from a rename or a merge. */
  aliases: string[]
  components: number
  processes: number
  handoffsOut: number
  handoffsIn: number
}

/** One end of a handoff, resolved so a table needs no second round trip. */
export type HandoffEnd = {
  id: string
  code: string
  name: string
  teamId: string | null
  teamName: string | null
}

export type Handoff = {
  id: string
  from: HandoffEnd
  to: HandoffEnd
  kind: 'kafka' | 'declared'
  /** The topic that carries it. Null on a declared handoff. */
  viaNode: string | null
  via: 'interaction' | 'rollup'
  declared: boolean
  derived: boolean
  /** How much the topology corroborates a declared claim. */
  support: 'kafka' | 'component' | 'none'
  crossTeam: boolean
  fromEdgeId: string | null
  toEdgeId: string | null
  note: string | null
  firstSeen: string
}

/** Which team a process reaches, and what reaches them. */
export type TeamReach = {
  id: string
  name: string | null
  via: 'owner' | 'component' | 'handoff'
  viaNode: string
  registered: boolean
}

export type TeamDetail = {
  team: Team
  components: GraphNode[]
  processes: Process[]
  handoffs: { out: Handoff[]; in: Handoff[] }
  reaches: { team_id: string; name: string | null; n: number }[]
}

export type CoverageRow = {
  node: GraphNode
  processes: { code: string; name: string; level: number; via: ProcessTouch['via'] }[]
  covered: boolean
}

export type DriftFinding = {
  id: number
  kind: string
  subject_id: string | null
  severity: 'info' | 'warn'
  detail: string
  data: unknown
  detected_at: string
}

export type TopicFlow = {
  topic: { id: string; name: string } | null
  producers: (GraphEdge & { serviceName: string | null; team: string | null })[]
  consumers: (GraphEdge & { serviceName: string | null; team: string | null })[]
}

export type ContractVersions = {
  contracts: {
    contractId: string
    name: string | null
    bindings: { serviceId: string; version: string | null }[]
    versions: (string | null)[]
    skew: boolean
  }[]
}

export type SearchHit = {
  subject_kind: 'node' | 'edge' | 'unresolved' | 'process' | 'team'
  subject_id: string
  title: string
  repo: string
  /** The FTS5 highlight of the matching text, with <mark> already in it. */
  snippet: string
  /** Node kind for a node hit, otherwise the subject kind. */
  kind: NodeKind | 'edge' | 'unresolved' | 'process' | 'team'
  /** Both ends of an edge hit; null on anything else. */
  from: string | null
  to: string | null
}

export type UnresolvedRow = {
  id: number
  repo: string
  expected: string
  raw: string
  reason: string | null
}

export type RepoRow = {
  repo: string
  url?: string
  commit: string | null
  scannedAt: string | null
  ingestedAt: string | null
}

export type ManifestRow = {
  id: number
  repo: string
  commit_sha: string | null
  scanned_at: string | null
  ingested_at: string
  prompt_version: string | null
  producer_kind: string | null
  service_id: string | null
  source_file: string | null
  status: 'active' | 'superseded' | 'quarantined'
  errors: { path: string; message: string }[] | null
}

/* ------------------------------------------------------------ pages */

export type WidgetConfig = {
  i: string
  type: string
  title: string
  x: number
  y: number
  w: number
  h: number
  options: Record<string, string>
}

export type ScopeData = {
  focus: string
  depth: string
  kinds: string[]
  repos: string[]
  /** Canonical team ids, from the registry or from the data. */
  teams: string[]
  includeExternal: boolean
  /** A process code. Restricts the map to that process's components. */
  process: string
}

export type Dashboard = {
  id: number
  name: string
  slug: string | null
  layout: WidgetConfig[]
  scope: ScopeData | null
  sortOrder: number
  updatedAt: number
}

export type DashboardMeta = {
  id: number
  name: string
  slug: string | null
  sortOrder: number
  updatedAt: number
}
