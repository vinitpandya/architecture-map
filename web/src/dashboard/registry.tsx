import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useScope } from '../lib/scope'
import { DataGrid } from '../components/DataGrid'
import { EvidenceList } from '../components/EvidenceList'
import { Empty } from '../components/ui'
import { api } from '../lib/api'
import { EDGE_LABEL, KIND_LABEL, KIND_PLURAL, VIA_LABEL, displayCode, idValue, nodeHref, processHref } from '../lib/nodes'
import { MapCanvas } from '../graph/MapCanvas'
import { ProcessFlow } from '../graph/ProcessFlow'
import { ProcessTree } from '../components/ProcessTree'
import { full } from '../lib/format'
import type {
  ContractVersions,
  CoverageRow,
  DriftFinding,
  Evidence,
  NodeDetail,
  Process,
  ProcessDetail,
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

const PROCESS_FIELD: FieldDef = {
  key: 'code',
  label: 'Process code',
  kind: 'text',
  placeholder: 'e.g. 2.1 — empty follows the filter row',
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
          { value: 'processes', label: 'Processes' },
          { value: 'processLeaves', label: 'Atomic actions' },
          { value: 'processPacks', label: 'Process packs' },
          { value: 'coverage', label: 'Components covered' },
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
  {
    type: 'process-tree',
    label: 'Process tree',
    desc: 'The L1/L2/L3 hierarchy, collapsible',
    w: 6, h: 6, minW: 3, minH: 3,
    fields: [
      { key: 'rootCode', label: 'Start at', kind: 'text', placeholder: 'e.g. 2.1 — empty shows everything' },
      {
        key: 'maxLevel',
        label: 'Down to',
        kind: 'select',
        quick: true,
        choices: [
          { value: '', label: 'All' },
          { value: '2', label: 'L2' },
          { value: '1', label: 'L1' },
        ],
      },
    ],
  },
  {
    type: 'process-children',
    // Not "steps": the levels are decomposition, and a child says the same
    // thing as its parent in more detail rather than being a stage of it.
    label: 'Process parts',
    desc: "One process's parts, in order, with what each one touches",
    w: 7, h: 5, minW: 4, minH: 3,
    fields: [PROCESS_FIELD],
  },
  {
    type: 'process-flow',
    label: 'Process diagram',
    desc: "A process's parts as a sequence diagram",
    w: 7, h: 6, minW: 4, minH: 4,
    fields: [PROCESS_FIELD],
  },
  {
    type: 'process-coverage',
    label: 'Process coverage',
    desc: 'What the documented processes account for, and what they do not',
    w: 5, h: 5, minW: 3, minH: 3,
    fields: [{ key: 'nodeKind', label: 'Kind', kind: 'select', quick: true, dynamic: 'nodeKinds' }],
  },
  {
    type: 'process-list',
    label: 'Process actions',
    desc: 'Every leaf, with the component it happens at',
    w: 7, h: 5, minW: 4, minH: 3,
    fields: [
      { key: 'owner', label: 'Owner', kind: 'text', placeholder: 'e.g. trading' },
      { key: 'limit', label: 'Row limit', kind: 'text', placeholder: '100' },
    ],
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
  if (widget.type.startsWith('process-') && widget.options.code) {
    return `${def?.label ?? widget.type} · ${displayCode(widget.options.code)}`
  }
  if (widget.type === 'process-coverage' && widget.options.nodeKind) {
    return `${KIND_PLURAL[widget.options.nodeKind as NodeKind] ?? 'Components'} covered`
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
    case 'process-tree': return <ProcessTreeBody widget={widget} />
    case 'process-children': return <ProcessChildrenBody widget={widget} />
    case 'process-flow': return <ProcessFlowBody widget={widget} />
    case 'process-coverage': return <ProcessCoverageBody widget={widget} />
    case 'process-list': return <ProcessListBody widget={widget} />
    default: return <Empty title={`Unknown widget "${widget.type}"`} />
  }
}

function NodeLink({ id, label }: { id: string; label?: string }) {
  return <Link to={nodeHref(id)}>{label ?? idValue(id)}</Link>
}

function StatBody({ widget }: { widget: WidgetConfig }) {
  const { status } = useScope()
  if (!status) return null
  const kind = widget.options.kind || 'services'

  // Coverage is a ratio rather than a count, and reads as one.
  if (kind === 'coverage') {
    const { covered, total } = status.coverage ?? { covered: 0, total: 0 }
    return (
      <div>
        <div className="value" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>
          {full(covered ?? 0)}
          <span className="muted" style={{ fontSize: 18, fontWeight: 500 }}>
            {' '}/ {full(total ?? 0)}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          services and topics a documented process accounts for
        </div>
      </div>
    )
  }

  const value = status.counts[kind as keyof typeof status.counts] ?? 0
  const layerB = kind.startsWith('process')
  return (
    <div>
      <div className="value" style={{ fontSize: 30, fontWeight: 650, letterSpacing: '-0.02em' }}>
        {full(value)}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {layerB
          ? `across ${status.counts.processPacks} authored ${status.counts.processPacks === 1 ? 'pack' : 'packs'}`
          : `across ${status.repos.length} scanned ${status.repos.length === 1 ? 'repo' : 'repos'}`}
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

/**
 * What each kind of finding means, in the terms someone reading it at 9am
 * needs. A finding nobody can act on is noise, and noise is how a map stops
 * being opened.
 */
const DRIFT_KINDS: Record<string, { title: string; why: string }> = {
  'no-producer': {
    title: 'Topics with no producer',
    why: 'Something is listening to a topic nothing in the scanned set writes. Either it crosses a team boundary, or the listener is dead.',
  },
  'no-consumer': {
    title: 'Topics with no consumer',
    why: 'Published, and nothing in the scanned set reads it.',
  },
  'version-skew': {
    title: 'Contracts bound at more than one version',
    why: 'One payload, several versions in production. The oldest binding is what constrains any change to it.',
  },
  'shared-database': {
    title: 'Databases more than one service writes',
    why: 'Every change to that schema is now a cross-team change, whether or not anyone has noticed.',
  },
  'multiple-owners': {
    title: 'Contested ownership',
    why: 'Two repositories claim the same thing. One of them is wrong.',
  },
  'near-miss': {
    title: 'Ids that might be the same thing',
    why: 'Two ids that normalise identically. Probably one thing spelt twice — a human decides, never the ingest.',
  },
  'orphan-endpoint': {
    title: 'Endpoints nobody serves',
    why: 'A route somebody calls that nothing in the scanned set exposes.',
  },
  'stale-evidence': {
    title: 'Citations that no longer match',
    why: 'The line a fact was read from has changed since the scan.',
  },
}

/**
 * Where a finding's subject lives. A process finding names a process, a
 * topology finding names a node, and they are different pages — a `proc:` id
 * is not a node and never has been.
 */
const isProcess = (id: string | null | undefined) => !!id?.startsWith('proc:')

const subjectHref = (id: string) => (isProcess(id) ? processHref(id.slice(5)) : nodeHref(id))

const subjectLabel = (id: string) => (isProcess(id) ? displayCode(id.slice(5)) : idValue(id))

/** The nodes named inside a finding's `data`, whatever shape that kind uses. */
function participants(f: DriftFinding): { id: string | null; label: string; note?: string }[] {
  const d = f.data as Record<string, unknown> | unknown[] | null
  if (!d) return []
  if (Array.isArray(d)) {
    // version-skew: [{service_id, name, version}]
    return d.map((b) => {
      const row = b as { service_id: string; name?: string; version?: string }
      return { id: row.service_id, label: row.name ?? idValue(row.service_id), note: row.version }
    })
  }
  const list = (key: string, note: (x: never) => string | undefined = () => undefined) =>
    ((d as Record<string, unknown>)[key] as { serviceId: string; name?: string }[] | undefined)?.map((x) => ({
      id: x.serviceId,
      label: x.name ?? idValue(x.serviceId),
      note: note(x as never),
    }))

  // The component a process named and the map does not have. There is no page
  // to link it to — that is the finding.
  const component = (d as { component?: string; how?: string }).component
  if (component) return [{ id: null, label: component, note: (d as { how?: string }).how }]

  // A call the document describes and no repository makes. Both ends are real,
  // so both link.
  const from = (d as { from?: string; to?: string; kind?: string }).from
  if (from) {
    const row = d as { from: string; to: string; kind: string; fromName?: string; toName?: string }
    return [
      { id: row.from, label: row.fromName ?? idValue(row.from), note: row.kind },
      { id: row.to, label: row.toName ?? idValue(row.to), note: 'the other end' },
    ]
  }

  const services = (d as { services?: { serviceId: string; name?: string; how?: string }[] }).services
  if (services) return services.map((x) => ({ id: x.serviceId, label: x.name ?? idValue(x.serviceId), note: x.how }))

  const claims = (d as { claims?: { repo: string; kind: string }[] }).claims
  if (claims) return claims.map((c) => ({ id: null, label: c.repo, note: c.kind }))

  const ids = (d as { ids?: string[] }).ids
  if (ids) return ids.map((id) => ({ id, label: id }))

  return list('consumers') ?? list('producers') ?? list('callers') ?? []
}

function DriftBody({ widget }: { widget: WidgetConfig }) {
  const { status } = useScope()
  const { data } = useQuery<{ findings: DriftFinding[] }>('/drift', {
    severity: widget.options.severity || '',
  })
  if (!data) return null
  if (!data.findings.length) {
    const n = status?.repos.length ?? 0
    return (
      <Empty title={`No drift detected across ${n} ${n === 1 ? 'repo' : 'repos'}`}>
        <span className="muted" style={{ fontSize: 12 }}>
          {n
            ? 'Every topic has a producer, every contract one version, every database one writer.'
            : 'Nothing has been ingested yet, so there is nothing to disagree about.'}
        </span>
      </Empty>
    )
  }

  const byKind = new Map<string, DriftFinding[]>()
  for (const f of data.findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, [])
    byKind.get(f.kind)!.push(f)
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {[...byKind].map(([kind, findings]) => (
        <section key={kind}>
          <div className="drift-group-head">
            <h4>{DRIFT_KINDS[kind]?.title ?? kind}</h4>
            <span className="pill">{findings.length}</span>
          </div>
          {DRIFT_KINDS[kind] && <p className="muted drift-why">{DRIFT_KINDS[kind].why}</p>}
          <ul className="drift-list">
            {findings.map((f) => (
              <Finding key={f.id} finding={f} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Finding({ finding }: { finding: DriftFinding }) {
  const [open, setOpen] = useState(false)
  const [evidence, setEvidence] = useState<Evidence[] | null>(null)
  const who = participants(finding)
  const subject = finding.subject_id
  const process = isProcess(subject)

  // Citations are fetched when a finding is opened, not for all of them up
  // front — most findings are never expanded. A process has no evidence by
  // design: its facts are asserted by people, so there is nothing to fetch.
  useEffect(() => {
    if (!open || evidence || !subject || process) return
    let cancelled = false
    api
      .get<NodeDetail>('/node', { id: subject })
      .then((d) => !cancelled && setEvidence(d.evidence.slice(0, 3)))
      .catch(() => !cancelled && setEvidence([]))
    return () => {
      cancelled = true
    }
  }, [open, evidence, subject, process])

  return (
    <li className={`drift-finding ${finding.severity}`}>
      <button type="button" className="drift-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`drift-dot ${finding.severity}`} aria-hidden="true" />
        <span className="drift-subject">{subject ? subjectLabel(subject) : 'the estate'}</span>
        <span className="drift-detail">{finding.detail}</span>
        <span className="drift-caret" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="drift-body">
          {who.length > 0 && (
            <ul className="drift-parties">
              {who.map((p) => (
                <li key={`${p.id ?? ''}${p.label}`}>
                  {p.id ? (
                    <NodeLink id={p.id} label={p.label} />
                  ) : (
                    <code className="proc-missing">{p.label}</code>
                  )}
                  {p.note && <span className="muted"> · {p.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {subject && !process && (
            <>
              {evidence === null ? (
                <span className="spinner" />
              ) : evidence.length ? (
                <EvidenceList evidence={evidence} />
              ) : (
                <p className="muted" style={{ fontSize: 12 }}>
                  No citation on the subject itself — its edges carry the evidence.
                </p>
              )}
            </>
          )}
          {process && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              A process is asserted by a person, not derived from code, so it carries a source rather
              than a file and a line.
            </p>
          )}
          {subject && <Link to={subjectHref(subject)}>Open details →</Link>}
        </div>
      )}
    </li>
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

/* --------------------------------------------------------------- layer B */

/**
 * A process code from the widget, or the one in the filter row. Same rule as
 * every other widget: its own option wins when set.
 */
function useProcessCode(widget: WidgetConfig) {
  const { scope } = useScope()
  return (widget.options.code || scope.process || '').trim().replace(/^[Ll]/, '')
}

const NO_PACKS = (
  <Empty title="No process packs loaded">
    <span className="muted" style={{ fontSize: 12 }}>
      Processes are written by people, not scanned. Run <code>npm run seed:demo</code>, or take the
      authoring prompt from the Scan page.
    </span>
  </Empty>
)

function ProcessTreeBody({ widget }: { widget: WidgetConfig }) {
  const { data } = useQuery<{ processes: Process[] }>('/processes', {
    root: widget.options.rootCode || '',
    maxLevel: widget.options.maxLevel || '',
  })
  if (!data) return null
  if (!data.processes.length) return NO_PACKS
  return <ProcessTree processes={data.processes} openToLevel={2} showOwner={false} />
}

function ProcessChildrenBody({ widget }: { widget: WidgetConfig }) {
  const code = useProcessCode(widget)
  const { data } = useQuery<ProcessDetail>(code ? '/process' : null, { code })

  if (!code)
    return (
      <Empty title="Pick a process">
        <span className="muted" style={{ fontSize: 12 }}>
          Set a code on this widget, or choose one in the filter row.
        </span>
      </Empty>
    )
  if (!data) return null
  if (!data.children.length)
    return (
      <Empty title={`${displayCode(data.process.code)} is an atomic action`}>
        <span className="muted" style={{ fontSize: 12 }}>
          A level 3 decomposes into nothing — it is the work itself.
        </span>
      </Empty>
    )

  return (
    <DataGrid
      rows={data.children}
      rowKey={(p) => p.id}
      defaultSort={null}
      columns={[
        {
          key: 'code',
          label: 'Code',
          value: (p) => p.code,
          render: (p) => <Link to={processHref(p.code)}>{displayCode(p.code)}</Link>,
        },
        {
          key: 'name',
          label: 'What happens',
          wide: true,
          value: (p) => p.name,
          render: (p) => <Link to={processHref(p.code)}>{p.name}</Link>,
        },
        {
          key: 'node',
          label: 'At',
          value: (p) => (p.node ? idValue(p.node) : ''),
          render: (p) =>
            !p.node ? (
              <span className="muted">—</span>
            ) : p.unresolved.node ? (
              <span className="proc-missing" title="No such component in the map">
                {idValue(p.node)}
              </span>
            ) : (
              <NodeLink id={p.node} />
            ),
        },
        {
          key: 'edge',
          label: 'Over',
          value: (p) => (p.edge ? `${EDGE_LABEL[p.edge.kind]} ${idValue(p.edge.to)}` : ''),
          render: (p) =>
            !p.edge ? (
              <span className="muted">—</span>
            ) : (
              <span
                className={p.unresolved.edge ? 'proc-missing' : undefined}
                title={p.unresolved.edge ? 'No scanned repository does this' : undefined}
              >
                {EDGE_LABEL[p.edge.kind]} {idValue(p.edge.to)}
              </span>
            ),
        },
      ]}
    />
  )
}

function ProcessFlowBody({ widget }: { widget: WidgetConfig }) {
  const code = useProcessCode(widget)
  const { data } = useQuery<ProcessDetail>(code ? '/process' : null, { code })

  if (!code)
    return (
      <Empty title="Pick a process">
        <span className="muted" style={{ fontSize: 12 }}>
          Set a code on this widget, or choose one in the filter row.
        </span>
      </Empty>
    )
  if (!data) return null
  if (!data.children.some((c) => c.edge))
    return <Empty title="Nothing to draw — no part of this names an interaction" />

  return (
    <ProcessFlow
      children={data.children}
      nameOf={(id) => data.components.find((c) => c.id === id)?.name ?? idValue(id)}
      title={`${displayCode(data.process.code)} ${data.process.name}`}
    />
  )
}

function ProcessCoverageBody({ widget }: { widget: WidgetConfig }) {
  const kind = (widget.options.nodeKind || 'service') as NodeKind
  const { data } = useQuery<{ components: CoverageRow[] }>('/coverage', { kinds: kind })
  const { status } = useScope()
  if (!data) return null
  if (!data.components.length) return <Empty title={`No ${KIND_PLURAL[kind].toLowerCase()} in the map`} />
  if (!status?.counts.processPacks) return NO_PACKS

  const covered = data.components.filter((c) => c.covered).length

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {covered} of {data.components.length} accounted for by a documented process.
      </p>
      <DataGrid
        rows={data.components}
        rowKey={(c) => c.node.id}
        columns={[
          {
            key: 'name',
            label: KIND_LABEL[kind],
            value: (c) => c.node.name,
            render: (c) => <NodeLink id={c.node.id} label={c.node.name} />,
          },
          {
            key: 'processes',
            label: 'Processes',
            wide: true,
            value: (c) => c.processes.length,
            render: (c) =>
              c.processes.length ? (
                <span className="proc-chiplist">
                  {c.processes
                    .filter((p) => p.level === 3)
                    .slice(0, 4)
                    .map((p) => (
                      <Link key={p.code} to={processHref(p.code)} title={p.name}>
                        {displayCode(p.code)}
                      </Link>
                    ))}
                  {c.processes.filter((p) => p.level === 3).length > 4 && (
                    <span className="muted">
                      +{c.processes.filter((p) => p.level === 3).length - 4}
                    </span>
                  )}
                </span>
              ) : (
                <span className="muted">nothing documented</span>
              ),
          },
        ]}
      />
    </div>
  )
}

function ProcessListBody({ widget }: { widget: WidgetConfig }) {
  const { data } = useQuery<{ processes: Process[] }>('/processes', {
    owner: widget.options.owner || '',
    limit: widget.options.limit || '',
  })
  if (!data) return null
  const leaves = data.processes.filter((p) => p.childCount === 0)
  if (!leaves.length) return NO_PACKS

  return (
    <DataGrid
      rows={leaves}
      rowKey={(p) => p.id}
      defaultSort={null}
      columns={[
        {
          key: 'code',
          label: 'Code',
          value: (p) => p.code,
          render: (p) => <Link to={processHref(p.code)}>{displayCode(p.code)}</Link>,
        },
        {
          key: 'name',
          label: 'Action',
          wide: true,
          value: (p) => p.name,
          render: (p) => <Link to={processHref(p.code)}>{p.name}</Link>,
        },
        {
          key: 'node',
          label: 'At',
          value: (p) => (p.node ? idValue(p.node) : ''),
          render: (p) =>
            !p.node ? (
              <span className="muted">—</span>
            ) : p.unresolved.node ? (
              <span className="proc-missing">{idValue(p.node)}</span>
            ) : (
              <NodeLink id={p.node} />
            ),
        },
        { key: 'owner', label: 'Owner', value: (p) => p.owner ?? '' },
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
