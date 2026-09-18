import { Link } from 'react-router-dom'
import { useQuery, useScope } from '../lib/scope'
import { DataGrid } from '../components/DataGrid'
import { Empty } from '../components/ui'
import { EDGE_LABEL, KIND_LABEL, KIND_PLURAL, idValue, nodeHref } from '../lib/nodes'
import { MapCanvas } from '../graph/MapCanvas'
import { full } from '../lib/format'
import type {
  ContractVersions,
  DriftFinding,
  GraphEdge,
  GraphNode,
  NodeKind,
  RepoRow,
  TopicFlow,
  UnresolvedRow,
  WidgetConfig,
} from '../lib/api'
import { ROW_H, GAP } from './Grid'

export type FieldDef = {
  key: string
  label: string
  kind: 'select' | 'text'
  choices?: { value: string; label: string }[]
  placeholder?: string
  /** Hide the field unless the current options warrant it. */
  showIf?: (options: Record<string, string>) => boolean
  /** Also surface the field on the widget header as an inline quick control. */
  quick?: boolean
  /** Choices resolved at render time from ingested data instead of statically. */
  dynamic?: 'repos' | 'nodeKinds'
}

export type WidgetDef = {
  type: string
  label: string
  desc: string
  w: number
  h: number
  minW: number
  minH: number
  fields: FieldDef[]
  /** Kept for saved layouts but left out of the add-widget picker. */
  hidden?: boolean
}

const NODE_KIND_CHOICES = (Object.keys(KIND_LABEL) as NodeKind[]).map((k) => ({
  value: k,
  label: KIND_PLURAL[k],
}))

const EDGE_KIND_CHOICES = Object.entries(EDGE_LABEL).map(([value, label]) => ({ value, label }))

const NODE_FIELD: FieldDef = {
  key: 'nodeId',
  label: 'Node id',
  kind: 'text',
  placeholder: 'e.g. topic:users.created.v2 — empty follows the filter row focus',
}

const SCOPE_FIELDS: FieldDef[] = [
  { key: 'repos', label: 'Limit to repos (comma-separated)', kind: 'text', placeholder: 'e.g. payments-service' },
  { key: 'limit', label: 'Row limit', kind: 'text', placeholder: '50' },
]

/** Resolve a field's choices, folding in data-driven (dynamic) lists. */
export function fieldChoices(
  f: FieldDef,
  repos: string[]
): { value: string; label: string }[] {
  if (f.dynamic === 'repos') {
    return [{ value: '', label: 'All repos' }, ...repos.map((r) => ({ value: r, label: r }))]
  }
  if (f.dynamic === 'nodeKinds') return NODE_KIND_CHOICES
  return f.choices ?? []
}

export const WIDGETS: WidgetDef[] = [
  {
    type: 'stat',
    label: 'Stat',
    desc: 'A single number from the estate',
    w: 3, h: 2, minW: 2, minH: 2,
    fields: [
      {
        key: 'kind',
        label: 'Measure',
        kind: 'select',
        choices: [
          { value: 'services', label: 'Services' },
          { value: 'topics', label: 'Kafka topics' },
          { value: 'databases', label: 'Databases' },
          { value: 'caches', label: 'Caches' },
          { value: 'contracts', label: 'Contracts' },
          { value: 'endpoints', label: 'Endpoints' },
          { value: 'externals', label: 'External systems' },
          { value: 'edges', label: 'Relationships' },
          { value: 'drift', label: 'Drift findings' },
          { value: 'unresolved', label: 'Unresolved references' },
          { value: 'orphans', label: 'Orphan nodes' },
          { value: 'quarantined', label: 'Quarantined manifests' },
        ],
      },
    ],
  },
  {
    type: 'map',
    label: 'Map',
    desc: 'The graph, focused and filtered',
    w: 12, h: 6, minW: 4, minH: 4,
    fields: [
      NODE_FIELD,
      {
        key: 'depth',
        label: 'Depth',
        kind: 'select',
        quick: true,
        // A map with no node of its own follows the filter row, depth
        // included, so its own depth control would be a lie.
        showIf: (options) => !!options.nodeId,
        choices: [
          { value: '1', label: '1 hop' },
          { value: '2', label: '2 hops' },
          { value: 'all', label: 'All' },
        ],
      },
    ],
  },
  {
    type: 'node-list',
    label: 'Node list',
    desc: 'Services, topics, databases — any kind, as a table',
    w: 6, h: 4, minW: 3, minH: 3,
    fields: [
      { key: 'nodeKind', label: 'Kind', kind: 'select', quick: true, dynamic: 'nodeKinds' },
      ...SCOPE_FIELDS,
    ],
  },
  {
    type: 'edge-list',
    label: 'Relationship list',
    desc: 'Every edge of one kind, with its evidence',
    w: 6, h: 4, minW: 3, minH: 3,
    fields: [
      { key: 'edgeKind', label: 'Relationship', kind: 'select', quick: true, choices: EDGE_KIND_CHOICES },
      ...SCOPE_FIELDS,
    ],
  },
  {
    type: 'topic-flow',
    label: 'Topic flow',
    desc: 'Producers and consumers of one topic, side by side',
    w: 7, h: 5, minW: 4, minH: 4,
    fields: [NODE_FIELD],
  },
  {
    type: 'contract-versions',
    label: 'Contract versions',
    desc: 'Who binds which version, and where they diverge',
    w: 7, h: 5, minW: 4, minH: 3,
    fields: [
      {
        key: 'skewOnly',
        label: 'Show',
        kind: 'select',
        quick: true,
        choices: [
          { value: '', label: 'All' },
          { value: 'true', label: 'Skew only' },
        ],
      },
    ],
  },
  {
    type: 'drift',
    label: 'Drift',
    desc: 'Findings that say the map has stopped matching the code',
    w: 6, h: 4, minW: 3, minH: 3,
    fields: [
      {
        key: 'severity',
        label: 'Severity',
        kind: 'select',
        quick: true,
        choices: [
          { value: '', label: 'All' },
          { value: 'warn', label: 'Warnings' },
          { value: 'info', label: 'Info' },
        ],
      },
    ],
  },
  {
    type: 'unresolved',
    label: 'Unresolved',
    desc: 'References a scan saw but could not pin down',
    w: 5, h: 4, minW: 3, minH: 3,
    fields: SCOPE_FIELDS,
  },
  {
    type: 'repos',
    label: 'Repositories',
    desc: 'What has been scanned, and how long ago',
    w: 12, h: 4, minW: 4, minH: 3,
    fields: [],
  },
]

export const widgetDef = (type: string) => WIDGETS.find((w) => w.type === type)

export function defaultTitle(widget: WidgetConfig): string {
  const def = widgetDef(widget.type)
  if (widget.type === 'stat') {
    const kind = widget.options.kind || 'services'
    return def?.fields[0].choices?.find((c) => c.value === kind)?.label ?? def?.label ?? widget.type
  }
  if (widget.type === 'node-list') {
    return KIND_PLURAL[(widget.options.nodeKind || 'service') as NodeKind] ?? 'Nodes'
  }
  if (widget.type === 'edge-list') {
    return EDGE_LABEL[widget.options.edgeKind as keyof typeof EDGE_LABEL] ?? 'Relationships'
  }
  if (widget.type === 'topic-flow' && widget.options.nodeId) {
    return idValue(widget.options.nodeId)
  }
  return def?.label ?? widget.type
}

/** Pixel height available to a widget body, from its grid height. */
export function bodyHeight(h: number): number {
  return h * ROW_H + (h - 1) * GAP - 40 /* header */ - 20 /* padding */
}

/** Per-widget scope overrides; empty values fall through to the filter row. */
function widgetExtra(options: Record<string, string>): Record<string, string> {
  const extra: Record<string, string> = {}
  if (options.repos) extra.repos = options.repos
  if (options.limit) extra.limit = options.limit
  return extra
}

/* --------------------------------------------------------- quick controls */

/**
 * The inline controls on a widget header: every `quick` select renders as a
 * segmented group (≤3 choices) or a compact dropdown. The ⚙ editor keeps the
 * full set.
 */
export function WidgetQuickBar({
  widget,
  onPatch,
}: {
  widget: WidgetConfig
  onPatch: (patch: Record<string, string>) => void
}) {
  const { status } = useScope()
  const repos = status?.repos.map((r) => r.repo) ?? []
  const def = widgetDef(widget.type)
  if (!def) return null

  const quick = def.fields.filter(
    (f) =>
      f.quick &&
      f.kind === 'select' &&
      (f.choices?.length || f.dynamic) &&
      (!f.showIf || f.showIf(widget.options))
  )
  if (!quick.length) return null

  return (
    <span className="widget-quick" onPointerDown={(e) => e.stopPropagation()}>
      {quick.map((f) => {
        const choices = fieldChoices(f, repos)
        if (!choices.length) return null
        const current = widget.options[f.key] ?? choices[0].value
        return choices.length <= 3 ? (
          <span key={f.key} className="segmented" role="group" aria-label={f.label}>
            {choices.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={current === c.value}
                onClick={() => onPatch({ [f.key]: c.value })}
              >
                {c.label}
              </button>
            ))}
          </span>
        ) : (
          <select
            key={f.key}
            aria-label={f.label}
            value={current}
            onChange={(e) => onPatch({ [f.key]: e.target.value })}
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )
      })}
    </span>
  )
}

/* ---------------------------------------------------------- widget bodies */

export function WidgetBody({ widget }: { widget: WidgetConfig }) {
  switch (widget.type) {
    case 'stat': return <StatBody widget={widget} />
    case 'map': return <MapBody widget={widget} />
    case 'node-list': return <NodeListBody widget={widget} />
    case 'edge-list': return <EdgeListBody widget={widget} />
    case 'topic-flow': return <TopicFlowBody widget={widget} />
    case 'contract-versions': return <ContractVersionsBody widget={widget} />
    case 'drift': return <DriftBody widget={widget} />
    case 'unresolved': return <UnresolvedBody widget={widget} />
    case 'repos': return <ReposBody />
    default: return <Empty title={`Unknown widget "${widget.type}"`} />
  }
}

function NodeLink({ id, label }: { id: string; label?: string }) {
  return <Link to={nodeHref(id)}>{label ?? idValue(id)}</Link>
}

function StatBody({ widget }: { widget: WidgetConfig }) {
  const { status } = useScope()
  if (!status) return null
  const kind = (widget.options.kind || 'services') as keyof typeof status.counts
  const value = status.counts[kind] ?? 0
  return (
    <div>
      <div className="value" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>
        {full(value)}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        across {status.repos.length} scanned {status.repos.length === 1 ? 'repo' : 'repos'}
      </div>
    </div>
  )
}

function MapBody({ widget }: { widget: WidgetConfig }) {
  const { scope } = useScope()
  // A map pinned to a node by its own options answers a fixed question and
  // carries its own depth. An unpinned one is the page's map and follows the
  // filter row, which is where §10 puts focus and depth.
  const pinned = widget.options.nodeId
  return (
    <MapCanvas
      height={bodyHeight(widget.h)}
      focus={pinned || scope.focus}
      depth={pinned ? widget.options.depth || '1' : scope.depth}
      pinned={!!pinned}
    />
  )
}

function NodeListBody({ widget }: { widget: WidgetConfig }) {
  const kind = (widget.options.nodeKind || 'service') as NodeKind
  const { data } = useQuery<{ nodes: GraphNode[] }>('/nodes', {
    ...widgetExtra(widget.options),
    kinds: kind,
  })
  if (!data) return null
  if (!data.nodes.length) return <Empty title={`No ${KIND_PLURAL[kind].toLowerCase()} yet`} />

  return (
    <DataGrid
      rows={data.nodes}
      rowKey={(n) => n.id}
      columns={[
        { key: 'name', label: 'Name', value: (n) => n.name, render: (n) => <NodeLink id={n.id} label={n.name} /> },
        ...(kind === 'service'
          ? [{ key: 'team', label: 'Team', value: (n: GraphNode) => n.team ?? '' }]
          : []),
        { key: 'ownerRepo', label: 'Owner', value: (n) => n.ownerRepo ?? '' },
        { key: 'degree', label: 'Links', align: 'right' as const, value: (n) => n.degree ?? 0 },
      ]}
    />
  )
}

function EdgeListBody({ widget }: { widget: WidgetConfig }) {
  const { data } = useQuery<{ edges: GraphEdge[] }>('/edges', {
    ...widgetExtra(widget.options),
    kinds: widget.options.edgeKind || 'kafka.produce',
  })
  if (!data) return null
  if (!data.edges.length) return <Empty title="No relationships of that kind" />

  return (
    <DataGrid
      rows={data.edges}
      rowKey={(e) => e.id}
      columns={[
        { key: 'from', label: 'From', value: (e) => idValue(e.from), render: (e) => <NodeLink id={e.from} /> },
        { key: 'to', label: 'To', value: (e) => idValue(e.to), render: (e) => <NodeLink id={e.to} /> },
        { key: 'description', label: 'What it does', wide: true, value: (e) => e.description ?? '' },
        { key: 'confidence', label: 'Confidence', value: (e) => e.confidence },
      ]}
    />
  )
}

function TopicFlowBody({ widget }: { widget: WidgetConfig }) {
  const { scope } = useScope()
  const id = widget.options.nodeId || scope.focus
  const { data } = useQuery<TopicFlow>(id ? '/topic-flow' : null, { id })

  if (!id) return <Empty title="Pick a topic" >
    <span className="muted" style={{ fontSize: 12 }}>Set a node id on this widget, or focus one in the filter row.</span>
  </Empty>
  if (!data) return null

  const side = (label: string, rows: TopicFlow['producers']) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="nav-group-label">{label}</div>
      {rows.length ? (
        <DataGrid
          rows={rows}
          rowKey={(e) => e.id}
          columns={[
            {
              key: 'from',
              label: 'Service',
              value: (e) => e.serviceName ?? idValue(e.from),
              render: (e) => <NodeLink id={e.from} label={e.serviceName ?? undefined} />,
            },
            { key: 'description', label: 'Why', wide: true, value: (e) => e.description ?? '' },
          ]}
        />
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>None</p>
      )}
    </div>
  )

  return (
    <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
      {side('Producers', data.producers)}
      {side('Consumers', data.consumers)}
    </div>
  )
}

function ContractVersionsBody({ widget }: { widget: WidgetConfig }) {
  const { data } = useQuery<ContractVersions>('/contract-versions', {
    skewOnly: widget.options.skewOnly || '',
  })
  if (!data) return null
  if (!data.contracts.length) return <Empty title="No contract bindings yet" />

  return (
    <DataGrid
      rows={data.contracts}
      rowKey={(c) => c.contractId}
      columns={[
        {
          key: 'contractId',
          label: 'Contract',
          value: (c) => c.name ?? idValue(c.contractId),
          render: (c) => <NodeLink id={c.contractId} label={c.name ?? undefined} />,
        },
        { key: 'services', label: 'Bound by', align: 'right' as const, value: (c) => c.bindings.length },
        {
          key: 'versions',
          label: 'Versions',
          value: (c) => c.versions.filter(Boolean).join(', '),
          render: (c) => (
            <span style={{ color: c.skew ? 'var(--status-critical)' : undefined }}>
              {c.versions.filter(Boolean).join(', ') || '—'}
            </span>
          ),
        },
      ]}
    />
  )
}

function DriftBody({ widget }: { widget: WidgetConfig }) {
  const { data } = useQuery<{ findings: DriftFinding[] }>('/drift', {
    severity: widget.options.severity || '',
  })
  if (!data) return null
  if (!data.findings.length) return <Empty title="No drift detected" />

  return (
    <DataGrid
      rows={data.findings}
      rowKey={(f) => f.id}
      columns={[
        { key: 'kind', label: 'Finding', value: (f) => f.kind },
        {
          key: 'subject_id',
          label: 'Subject',
          value: (f) => (f.subject_id ? idValue(f.subject_id) : ''),
          render: (f) => (f.subject_id ? <NodeLink id={f.subject_id} /> : '—'),
        },
        { key: 'detail', label: 'Detail', wide: true, value: (f) => f.detail },
      ]}
    />
  )
}

function UnresolvedBody({ widget }: { widget: WidgetConfig }) {
  const { data } = useQuery<{ unresolved: UnresolvedRow[] }>('/unresolved', widgetExtra(widget.options))
  if (!data) return null
  if (!data.unresolved.length) return <Empty title="Nothing unresolved" />

  return (
    <DataGrid
      rows={data.unresolved}
      rowKey={(u) => u.id}
      columns={[
        { key: 'repo', label: 'Repo', value: (u) => u.repo },
        { key: 'expected', label: 'Expected', value: (u) => u.expected },
        { key: 'raw', label: 'Saw', wide: true, value: (u) => u.raw, render: (u) => <code>{u.raw}</code> },
      ]}
    />
  )
}

function ReposBody() {
  const { data } = useQuery<{ repos: RepoRow[]; configured: boolean }>('/repos')
  if (!data) return null
  if (!data.repos.length) {
    return <Empty title="No repositories configured">
      <span className="muted" style={{ fontSize: 12 }}>Copy repos.example.json to repos.json.</span>
    </Empty>
  }

  return (
    <DataGrid
      rows={data.repos}
      rowKey={(r) => r.repo}
      columns={[
        { key: 'repo', label: 'Repository', value: (r) => r.repo },
        {
          key: 'commit',
          label: 'Commit',
          value: (r) => r.commit ?? '',
          render: (r) => (r.commit ? <code>{r.commit}</code> : 'never scanned'),
        },
        { key: 'scannedAt', label: 'Scanned', value: (r) => r.scannedAt ?? '' },
      ]}
    />
  )
}
