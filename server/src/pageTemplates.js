import crypto from 'node:crypto'
import { db, getConfig } from './db.js'

/**
 * The shipped default layout for new pages. Replaceable by the user via
 * "Save as default" (stored in app_config).
 */
export const DEFAULT_PAGE_LAYOUT = [
  { type: 'stat', title: '', x: 0, y: 0, w: 3, h: 2, options: { kind: 'services' } },
  { type: 'stat', title: '', x: 3, y: 0, w: 3, h: 2, options: { kind: 'topics' } },
  { type: 'stat', title: '', x: 6, y: 0, w: 3, h: 2, options: { kind: 'edges' } },
  { type: 'stat', title: '', x: 9, y: 0, w: 3, h: 2, options: { kind: 'drift' } },
  { type: 'map', title: '', x: 0, y: 2, w: 12, h: 6, options: { depth: '1' } },
  { type: 'node-list', title: '', x: 0, y: 8, w: 6, h: 4, options: { nodeKind: 'service' } },
  { type: 'drift', title: '', x: 6, y: 8, w: 6, h: 4, options: { severity: '' } },
]

export function defaultPageLayout() {
  const stored = getConfig('default_layout', null)
  return Array.isArray(stored) && stored.length ? stored : DEFAULT_PAGE_LAYOUT
}

/** A fresh copy with new widget ids, ready to store on a page. */
export function instantiateLayout(layout) {
  return layout.map((w) => ({ ...w, i: crypto.randomUUID() }))
}

/**
 * The built-in pages, expressed as layouts so they stay fully editable in the
 * UI. Seeded once per slug; "Reset layout" re-applies the template. Widget
 * types and option keys mirror web/src/dashboard/registry.tsx.
 */
export const SYSTEM_PAGES = [
  {
    slug: 'map',
    name: 'Map',
    layout: [
      { i: 'mp-1', type: 'map', title: '', x: 0, y: 0, w: 12, h: 9, options: { depth: '1' } },
    ],
  },
  {
    slug: 'estate',
    name: 'Estate',
    layout: [
      { i: 'es-1', type: 'stat', title: '', x: 0, y: 0, w: 3, h: 2, options: { kind: 'services' } },
      { i: 'es-2', type: 'stat', title: '', x: 3, y: 0, w: 3, h: 2, options: { kind: 'topics' } },
      { i: 'es-3', type: 'stat', title: '', x: 6, y: 0, w: 3, h: 2, options: { kind: 'databases' } },
      { i: 'es-4', type: 'stat', title: '', x: 9, y: 0, w: 3, h: 2, options: { kind: 'contracts' } },
      { i: 'es-5', type: 'node-list', title: '', x: 0, y: 2, w: 6, h: 5, options: { nodeKind: 'service' } },
      { i: 'es-6', type: 'node-list', title: '', x: 6, y: 2, w: 6, h: 5, options: { nodeKind: 'kafka.topic' } },
      { i: 'es-7', type: 'repos', title: '', x: 0, y: 7, w: 12, h: 4, options: {} },
    ],
  },
  {
    slug: 'messaging',
    name: 'Messaging',
    layout: [
      { i: 'ms-1', type: 'node-list', title: '', x: 0, y: 0, w: 5, h: 6, options: { nodeKind: 'kafka.topic' } },
      { i: 'ms-2', type: 'topic-flow', title: '', x: 5, y: 0, w: 7, h: 6, options: {} },
      { i: 'ms-3', type: 'edge-list', title: '', x: 0, y: 6, w: 12, h: 4, options: { edgeKind: 'kafka.produce' } },
    ],
  },
  {
    slug: 'contracts',
    name: 'Contracts',
    layout: [
      { i: 'ct-1', type: 'contract-versions', title: '', x: 0, y: 0, w: 7, h: 6, options: { skewOnly: '' } },
      { i: 'ct-2', type: 'node-list', title: '', x: 7, y: 0, w: 5, h: 6, options: { nodeKind: 'contract' } },
    ],
  },
  {
    slug: 'processes',
    name: 'Process map',
    layout: [
      { i: 'pr-1', type: 'stat', title: '', x: 0, y: 0, w: 3, h: 2, options: { kind: 'processes' } },
      { i: 'pr-2', type: 'stat', title: '', x: 3, y: 0, w: 3, h: 2, options: { kind: 'processLeaves' } },
      { i: 'pr-3', type: 'stat', title: '', x: 6, y: 0, w: 3, h: 2, options: { kind: 'processPacks' } },
      { i: 'pr-4', type: 'stat', title: '', x: 9, y: 0, w: 3, h: 2, options: { kind: 'coverage' } },
      { i: 'pr-5', type: 'process-tree', title: '', x: 0, y: 2, w: 5, h: 8, options: { maxLevel: '' } },
      { i: 'pr-6', type: 'map', title: '', x: 5, y: 2, w: 7, h: 8, options: { depth: '1' } },
      { i: 'pr-7', type: 'process-children', title: '', x: 0, y: 10, w: 7, h: 5, options: {} },
      { i: 'pr-8', type: 'process-coverage', title: '', x: 7, y: 10, w: 5, h: 5, options: { nodeKind: 'kafka.topic' } },
    ],
  },
  {
    slug: 'teams',
    name: 'Teams and handoffs',
    layout: [
      { i: 'tm-1', type: 'stat', title: '', x: 0, y: 0, w: 3, h: 2, options: { kind: 'teams' } },
      { i: 'tm-2', type: 'stat', title: '', x: 3, y: 0, w: 3, h: 2, options: { kind: 'crossTeam' } },
      { i: 'tm-3', type: 'stat', title: '', x: 6, y: 0, w: 3, h: 2, options: { kind: 'undocumented' } },
      { i: 'tm-4', type: 'stat', title: '', x: 9, y: 0, w: 3, h: 2, options: { kind: 'processPacks' } },
      { i: 'tm-5', type: 'team-handoffs', title: '', x: 0, y: 2, w: 6, h: 7, options: {} },
      { i: 'tm-6', type: 'team-list', title: '', x: 6, y: 2, w: 6, h: 7, options: {} },
      { i: 'tm-7', type: 'process-handoffs', title: '', x: 0, y: 9, w: 6, h: 6, options: {} },
      { i: 'tm-8', type: 'process-map', title: '', x: 6, y: 9, w: 6, h: 6, options: {} },
    ],
  },
  {
    slug: 'health',
    name: 'Health',
    layout: [
      { i: 'hl-1', type: 'stat', title: '', x: 0, y: 0, w: 3, h: 2, options: { kind: 'drift' } },
      { i: 'hl-2', type: 'stat', title: '', x: 3, y: 0, w: 3, h: 2, options: { kind: 'unresolved' } },
      { i: 'hl-3', type: 'stat', title: '', x: 6, y: 0, w: 3, h: 2, options: { kind: 'orphans' } },
      { i: 'hl-4', type: 'stat', title: '', x: 9, y: 0, w: 3, h: 2, options: { kind: 'quarantined' } },
      { i: 'hl-5', type: 'drift', title: '', x: 0, y: 2, w: 7, h: 6, options: { severity: 'warn' } },
      { i: 'hl-6', type: 'unresolved', title: '', x: 7, y: 2, w: 5, h: 6, options: {} },
      { i: 'hl-7', type: 'process-coverage', title: '', x: 0, y: 8, w: 6, h: 5, options: { nodeKind: 'service' } },
      { i: 'hl-8', type: 'process-coverage', title: '', x: 6, y: 8, w: 6, h: 5, options: { nodeKind: 'kafka.topic' } },
    ],
  },
]

export function templateFor(slug) {
  return SYSTEM_PAGES.find((p) => p.slug === slug) ?? null
}

/** Insert any system page not in the database yet. Never overwrites. */
export function seedSystemPages() {
  const existing = new Set(
    db.prepare('SELECT slug FROM dashboards WHERE slug IS NOT NULL').all().map((r) => r.slug)
  )
  const insert = db.prepare(
    'INSERT INTO dashboards (name, slug, layout, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const now = Date.now()
  SYSTEM_PAGES.forEach((page, i) => {
    if (!existing.has(page.slug)) {
      insert.run(page.name, page.slug, JSON.stringify(page.layout), i, now, now)
    }
  })
}
