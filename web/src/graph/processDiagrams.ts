import type { Handoff, Process } from '../lib/api'
import { displayCode, flowDirection, flowVerb, idValue } from '../lib/nodes'

/**
 * Five ways of drawing one process, all generated from the same rows.
 *
 * The decomposition is the flow — the levels say the same thing in more
 * detail and the numbering is the order — so every one of these works at any
 * level without a second data model. What differs is the question each
 * answers: what talks to what (sequence), what happens and when (flow), where
 * it crosses a boundary (lanes), who picks it up (handoffs), and what it is
 * made of (tree).
 *
 * Nothing here invents a fact. A step with no interaction draws as a step with
 * no interaction, and a branch to a code nobody wrote draws as a dead end —
 * which is exactly what the finding says about it.
 */

export type DiagramKind = 'sequence' | 'flow' | 'lanes' | 'handoffs' | 'tree'

export const DIAGRAM_LABEL: Record<DiagramKind, string> = {
  sequence: 'Sequence',
  flow: 'Flow',
  lanes: 'Lanes',
  handoffs: 'Handoffs',
  tree: 'Decomposition',
}

export const DIAGRAM_SUB: Record<DiagramKind, string> = {
  sequence: 'What talks to what, in order',
  flow: 'What happens and what decides it, including where it stops',
  lanes: 'The same flow, split by whoever does each part',
  handoffs: 'Where this ends and somebody else begins',
  tree: 'What this is made of, all the way down',
}

/**
 * Who appears on the diagram. An endpoint is drawn as the service that serves
 * it — `api:pricing-service/GET /v1/rates/{}` carries the service name in the
 * id by construction (see the schema's nodeId), and "gateway → pricing-service"
 * reads as a call where "gateway → GET /v1/rates/{}" reads as a shrug.
 */
const participantFor = (id: string) =>
  id.startsWith('api:') ? `svc:${idValue(id).split('/')[0]}` : id

/**
 * Mermaid takes everything after `as` as the label and everything after `:` as
 * a message, so anything that would end either statement has to go. Quoting
 * the label is not the answer — mermaid renders the quotes.
 */
const clean = (s: string) => s.replace(/["'`;:#<>\n]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A flowchart label, which is quoted and so may keep punctuation a sequence
 * message may not. `"` still cannot survive — it closes the quote — and `#`
 * opens an HTML entity.
 */
const text = (s: string) => s.replace(/["`#<>\n]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A terminal or lane label, cut to something that fits in a box. A trigger and
 * an outcome are written as sentences — they are prose on the page above — and
 * a three-line stadium at the top of a flowchart is not a shape, it is a
 * paragraph with a border.
 */
const short = (s: string, max = 64) => {
  const t = text(s)
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/[\s,;.]+$/, '')}…`
}

const stepLabel = (p: Process) => text(`${displayCode(p.code)} ${p.name}`)

/* ──────────────────────────────────────────────────────────── sequence */

export function sequenceDiagram(
  children: Process[],
  nameOf: (id: string) => string,
  title = 'This process'
): string {
  const lines = ['sequenceDiagram', '  autonumber']
  const alias = new Map<string, string>()
  const declare = (id: string, label?: string) => {
    if (alias.has(id)) return alias.get(id)!
    const key = `P${alias.size}`
    alias.set(id, key)
    lines.push(`  participant ${key} as ${clean(label ?? nameOf(id)) || key}`)
    return key
  }

  // Participants are declared in order of first appearance, which is the order
  // the reader meets them: an interaction's two ends, or — for a step with no
  // interaction of its own — the component it happens at.
  for (const child of children) {
    if (child.edge) {
      const { source, target } = flowDirection(child.edge)
      declare(participantFor(source))
      declare(participantFor(target))
    } else if (child.node) {
      declare(participantFor(child.node))
    }
  }

  // A level 1's stages usually name nothing at all — decomposition is the
  // point, and the detail lives a level down. The process itself is then the
  // only participant there is, and each stage is a note against it. Without
  // this the diagram referred to a `P0` it never declared.
  const fallback = alias.size ? null : declare('__process__', title)

  for (const child of children) {
    const label = clean(`${child.code} ${child.name}`)
    if (!child.edge) {
      // Nothing to draw an arrow between, but the step still happened — and it
      // is drawn against the thing it happens at when it names one.
      const at = child.node ? alias.get(participantFor(child.node)) : undefined
      lines.push(`  Note over ${at ?? fallback ?? [...alias.values()][0]}: ${label}`)
      continue
    }
    const { source, target } = flowDirection(child.edge)
    const from = declare(participantFor(source))
    const to = declare(participantFor(target))
    const verb = flowVerb(child.edge.kind)
    // A dashed arrow for an interaction the code does not have, so an
    // unresolved step is visibly different rather than quietly the same.
    const arrow = child.edge.id ? '->>' : '-->>'
    lines.push(`  ${from}${arrow}${to}: ${label}`)
    if (!child.edge.id) lines.push(`  Note right of ${to}: ${clean(verb)} — not in the map`)
  }

  if (!children.length) lines.push(`  Note over ${declare('__process__', title)}: nothing to draw`)
  return lines.join('\n')
}

/* ────────────────────────────────────────────────────────────── the flow

   Fall-through is the model: a step with no `next` continues at the next
   sibling, because the numbering has always been the order. `next` says only
   what a number cannot — a condition, a jump, a stop — so a pack written
   before it existed draws exactly the straight line it always described.
*/

type Arm = { to: string; label: string | null }

/** Where each step goes, fall-through included, resolved to node ids. */
function successors(children: Process[]) {
  const index = new Map(children.map((c, i) => [c.code, i]))
  const ends = new Map<string, string>()
  const dangling = new Map<string, string>()
  const arms = new Map<string, Arm[]>()

  const endId = (label: string) => {
    if (!ends.has(label)) ends.set(label, `E${ends.size}`)
    return ends.get(label)!
  }
  const danglingId = (code: string) => {
    if (!dangling.has(code)) dangling.set(code, `X${dangling.size}`)
    return dangling.get(code)!
  }

  children.forEach((child, i) => {
    const branches = child.next ?? []
    if (!branches.length) {
      // The last step falls out of the process rather than off the end of the
      // array, which is what the outcome node is for.
      arms.set(child.code, [{ to: i + 1 < children.length ? `S${i + 1}` : 'done', label: null }])
      return
    }
    arms.set(
      child.code,
      branches.map((b) => {
        const label = b.when ? text(b.when) : null
        if (b.end) return { to: endId(text(b.end)), label }
        // A branch inside this process is a step on the diagram. One that
        // leaves it — an error path out of the stage — is drawn as itself,
        // and so is one nobody has written: both are real, and hiding either
        // would make the flow look complete when it is not.
        const at = b.to !== null ? index.get(b.to) : undefined
        return { to: at === undefined ? danglingId(b.to ?? '?') : `S${at}`, label }
      })
    )
  })

  return { arms, ends, dangling }
}

export function flowDiagram(process: Process, children: Process[]): string {
  if (!children.length) return `flowchart TD\n  only["${stepLabel(process)}"]`
  const lines = ['flowchart TD']
  const { arms, ends, dangling } = successors(children)
  const reachesDone = [...arms.values()].some((list) => list.some((a) => a.to === 'done'))

  lines.push(`  start(["${short(process.trigger ?? 'Start')}"])`)
  children.forEach((c, i) => lines.push(`  S${i}["${stepLabel(c)}"]`))
  for (const [label, id] of ends) lines.push(`  ${id}(["${label}"])`)
  for (const [code, id] of dangling) {
    lines.push(`  ${id}["${displayCode(code)} — not written"]`)
  }
  // Only when something arrives there. Where every arm ends in an outcome the
  // author wrote, a `done` node is an unreachable box floating beside the
  // diagram — which is what it was.
  if (reachesDone) lines.push(`  done(["${short(process.outcome ?? 'Done')}"])`)

  lines.push(`  start --> S0`)
  children.forEach((c, i) => {
    for (const arm of arms.get(c.code) ?? []) {
      lines.push(arm.label ? `  S${i} -- "${arm.label}" --> ${arm.to}` : `  S${i} --> ${arm.to}`)
    }
  })

  /* Optional steps, unresolved interactions and the steps that branch are
     marked rather than styled away: all three are things the reader has to
     know about this flow.

     A branching step is not drawn as a rhombus. The convention assumes a short
     question — "Permitted?" — and every label here is a sentence, which
     inflates a diamond to three times the area of the box beside it and turns
     a four-step diagram into a scroll. The condition is on the arrow, which is
     where it belongs, and the split is visible because the arrows split. */
  const optional = children.map((c, i) => (c.optional ? `S${i}` : null)).filter(Boolean)
  const unresolved = children.map((c, i) => (c.edge && !c.edge.id ? `S${i}` : null)).filter(Boolean)
  const branching = children.map((c, i) => ((c.next?.length ?? 0) > 1 ? `S${i}` : null)).filter(Boolean)
  lines.push('  classDef optional stroke-dasharray: 5 4')
  lines.push('  classDef missing stroke-dasharray: 2 3, opacity: 0.75')
  lines.push('  classDef branching stroke-width: 2px')
  if (optional.length) lines.push(`  class ${optional.join(',')} optional`)
  if (branching.length) lines.push(`  class ${branching.join(',')} branching`)
  if (unresolved.length || dangling.size) {
    lines.push(`  class ${[...unresolved, ...dangling.values()].join(',')} missing`)
  }
  return lines.join('\n')
}

/* ─────────────────────────────────────────────────────────────── lanes */

/**
 * How to split these steps into lanes: by team where more than one team is
 * involved, because that is the boundary worth seeing, and by the component
 * each step happens at otherwise.
 *
 * Shared with `available()` so the tab is offered on exactly the processes
 * this can draw something for. A diagram with one lane is a flowchart with a
 * box round it, and offering it teaches the reader the tabs are unreliable.
 */
export function laneSplit(children: Process[], nameOf: (id: string) => string) {
  const teams = new Set(children.map((c) => c.teamId).filter(Boolean))
  const by: 'team' | 'component' = teams.size > 1 ? 'team' : 'component'
  const laneOf = (c: Process) =>
    by === 'team'
      ? { id: c.teamId ?? '·none', name: c.teamName ?? c.teamId ?? 'No team' }
      : c.node
        ? { id: participantFor(c.node), name: nameOf(participantFor(c.node)) }
        : { id: '·none', name: 'Nothing named' }

  const lanes = new Map<string, { name: string; steps: number[] }>()
  children.forEach((c, i) => {
    const lane = laneOf(c)
    if (!lanes.has(lane.id)) lanes.set(lane.id, { name: lane.name, steps: [] })
    lanes.get(lane.id)!.steps.push(i)
  })
  return { by, lanes }
}

/**
 * The same flow, split into lanes. Which dimension is in use is returned, so
 * the page can say so rather than leaving the reader to guess why the lanes
 * are teams here and components there.
 */
export function laneDiagram(
  process: Process,
  children: Process[],
  nameOf: (id: string) => string
): { source: string; by: 'team' | 'component' | 'none' } {
  if (!children.length) return { source: `flowchart LR\n  only["${stepLabel(process)}"]`, by: 'none' }

  const { by, lanes } = laneSplit(children, nameOf)
  const lines = ['flowchart LR']
  const { arms, ends, dangling } = successors(children)
  const reachesDone = [...arms.values()].some((list) => list.some((a) => a.to === 'done'))

  // The terminals sit outside every lane, before it is opened: a trigger and
  // an outcome belong to the process, not to whichever team happened to reach
  // one last.
  lines.push(`  start(["${short(process.trigger ?? 'Start')}"])`)

  let n = 0
  for (const [, lane] of lanes) {
    lines.push(`  subgraph L${n++}["${text(lane.name)}"]`)
    lines.push('    direction TB')
    for (const i of lane.steps) lines.push(`    S${i}["${stepLabel(children[i])}"]`)
    lines.push('  end')
  }
  for (const [label, id] of ends) lines.push(`  ${id}(["${label}"])`)
  for (const [code, id] of dangling) lines.push(`  ${id}["${displayCode(code)} — not written"]`)
  if (reachesDone) lines.push(`  done(["${short(process.outcome ?? 'Done')}"])`)

  lines.push(`  start --> S0`)
  children.forEach((c, i) => {
    for (const arm of arms.get(c.code) ?? []) {
      lines.push(arm.label ? `  S${i} -- "${arm.label}" --> ${arm.to}` : `  S${i} --> ${arm.to}`)
    }
  })
  lines.push('  classDef missing stroke-dasharray: 2 3, opacity: 0.75')
  lines.push('  classDef branching stroke-width: 2px')
  if (dangling.size) lines.push(`  class ${[...dangling.values()].join(',')} missing`)
  const branching = children.map((c, i) => ((c.next?.length ?? 0) > 1 ? `S${i}` : null)).filter(Boolean)
  if (branching.length) lines.push(`  class ${branching.join(',')} branching`)

  return { source: lines.join('\n'), by }
}

/* ──────────────────────────────────────────────────────────── handoffs */

/**
 * The rows worth drawing, out of the three lists the API returns.
 *
 * `inside` is already leaf-to-leaf. `out` and `in` are rollups, and the rollup
 * produces one row per ancestor of the far end — `2 → 3`, `2 → 3.1` and
 * `2 → 3.1.2` are one crossing said three times. Only the deepest is real;
 * the others are the same fact with detail removed.
 *
 * "Deepest" has to mean deepest *along one chain*, though. Comparing depths
 * across a whole topic collapses two unrelated crossings that happen to share
 * a topic — `→ 3.1.2` and `→ 4.2.1` over the same topic are equally deep, so
 * one was kept and the other silently dropped. On the demo estate that lost
 * three crossings, every one of them cross-team, and two of them leaf rows
 * the rollup never touched: exactly the handoffs this diagram exists to show.
 *
 * So a row survives unless another row in its group is a strict descendant of
 * it. Unrelated far ends are incomparable and both stay.
 */
function handoffRows(links: { out: Handoff[]; in: Handoff[]; inside: Handoff[] }) {
  const under = (ancestor: string, code: string) => code.startsWith(`${ancestor}.`)
  const carriedBy = (h: Handoff) => h.viaNode ?? h.note ?? ''

  const deepest = (rows: Handoff[], far: (h: Handoff) => string, near: (h: Handoff) => string) => {
    // Identical rows first, so that an exact duplicate is not read as its own
    // descendant and removed along with the row it duplicates.
    const once = new Map<string, Handoff>()
    for (const h of rows) once.set(`${near(h)}\u0000${far(h)}\u0000${carriedBy(h)}`, h)

    /* Two crossings between the same pair over two topics are two facts, so
       what carried it is part of the group. A declared handoff has no topic
       and groups by its note instead. */
    const groups = new Map<string, Handoff[]>()
    for (const h of once.values()) {
      const key = `${near(h)}\u0000${carriedBy(h)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(h)
    }

    const kept: Handoff[] = []
    for (const group of groups.values()) {
      for (const h of group) {
        if (!group.some((other) => other !== h && under(far(h), far(other)))) kept.push(h)
      }
    }
    return kept
  }

  return [
    ...links.inside,
    ...deepest(links.out, (h) => h.to.code, (h) => h.from.code),
    ...deepest(links.in, (h) => h.from.code, (h) => h.to.code),
  ]
}

/**
 * This process's handoffs, as a picture rather than a list.
 *
 * Grouped by team, because a handoff that does not cross one is a detail and a
 * handoff that does is the thing nobody can see from inside a repository. A
 * declared-only handoff is dashed: nothing in the code backs it up, which is
 * exactly the claim worth looking at twice.
 */
export function handoffDiagram(
  process: Process,
  links: { out: Handoff[]; in: Handoff[]; inside: Handoff[] }
): string {
  const rows = handoffRows(links)
  if (!rows.length) {
    return `flowchart LR\n  none["${stepLabel(process)} hands off to nobody"]`
  }

  /* One box per process, whatever it appears in.

     A rolled-up row carries the LEAF pair's teams — deliberately, so a
     crossing is attributed to whoever performed it — which means this process
     turns up under two different teams on two of its own rows. Its own owner
     is the one true answer for its own box; everything else takes the team the
     row carries. */
  const lane = new Map<string, { name: string; codes: Map<string, string> }>()
  const ids = new Map<string, string>()
  const place = (end: Handoff['from']) => {
    if (ids.has(end.code)) return ids.get(end.code)!
    const own = end.code === process.code
    const teamId = (own ? process.teamId : end.teamId) ?? '·none'
    const teamName = (own ? process.teamName : end.teamName) ?? 'No team'
    if (!lane.has(teamId)) lane.set(teamId, { name: teamName, codes: new Map() })
    const id = `H${ids.size}`
    ids.set(end.code, id)
    lane.get(teamId)!.codes.set(end.code, text(`${displayCode(end.code)} ${end.name}`))
    return id
  }

  // Two passes: every box has to be inside its subgraph before any arrow
  // between them is written, or mermaid puts an arrow's end in the wrong one.
  const edges = rows.map((h) => ({ h, from: place(h.from), to: place(h.to) }))

  const lines = ['flowchart LR']
  let n = 0
  for (const [, group] of lane) {
    lines.push(`  subgraph T${n++}["${text(group.name)}"]`)
    lines.push('    direction TB')
    for (const [code, label] of group.codes) lines.push(`    ${ids.get(code)}["${label}"]`)
    lines.push('  end')
  }

  for (const { h, from, to } of edges) {
    const label = h.viaNode ? idValue(h.viaNode) : h.note ? 'declared' : 'handoff'
    // Dashed where the code does not corroborate it: a claim with nothing
    // behind it should not look like a fact the scan found.
    lines.push(`  ${from} ${h.derived ? '-->' : '-.->'}|"${short(label, 40)}"| ${to}`)
  }
  return lines.join('\n')
}

/* ───────────────────────────────────────────────────────── decomposition */

/**
 * The subtree in one picture. The tree page shows the same thing as an
 * indented list, which is better for finding a code and useless for seeing the
 * shape — a level 1 with nine stages and thirty actions is a shape.
 */
export function treeDiagram(process: Process, descendants: Process[]): string {
  if (!descendants.length) {
    return `flowchart LR\n  root["${stepLabel(process)}"]\n  leaf["Nothing decomposes this"]\n  root --> leaf`
  }
  const lines = ['flowchart LR']
  const id = new Map<string, string>([[process.code, 'root']])
  lines.push(`  root["${stepLabel(process)}"]`)
  descendants.forEach((d, i) => {
    id.set(d.code, `N${i}`)
    lines.push(`  N${i}["${stepLabel(d)}"]`)
  })
  for (const d of descendants) {
    // The parent is the code with its last segment removed — the hierarchy has
    // always lived in the number, and reading it from there means the picture
    // cannot disagree with the tree.
    const parent = d.code.slice(0, d.code.lastIndexOf('.'))
    const from = id.get(parent)
    if (from) lines.push(`  ${from} --> ${id.get(d.code)}`)
  }
  return lines.join('\n')
}

/* ────────────────────────────────────────────────────────── which apply */

/** Whether a kind has anything to draw, so a dead tab is never offered. */
export function available(
  kind: DiagramKind,
  detail: { children: Process[]; descendants: Process[]; links: { out: Handoff[]; in: Handoff[]; inside: Handoff[] } },
  nameOf: (id: string) => string
): boolean {
  if (!detail.children.length) return false
  switch (kind) {
    case 'handoffs':
      return detail.links.out.length + detail.links.in.length + detail.links.inside.length > 0
    case 'tree':
      // More than one level below, or the picture is the children fanned out —
      // which the list above it already is, drawn better.
      return detail.descendants.length > detail.children.length
    case 'lanes':
      // One lane is no lanes. This is the L2 case: four steps, one team, one
      // service, and a swimlane diagram of a single swimlane.
      return laneSplit(detail.children, nameOf).lanes.size > 1
    default:
      return true
  }
}
