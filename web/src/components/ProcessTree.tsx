import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Process } from '../lib/api'
import { displayCode, idValue, nodeHref, processHref } from '../lib/nodes'
import { Highlight, ListSearch, MatchedIn, NoMatch, textOf } from './SearchBox'

/** What a process is found by: its code either way it is written, and what it names. */
const processText = (p: Process) =>
  textOf(
    displayCode(p.code),
    p.code,
    p.name,
    p.pack,
    p.owner,
    p.teamName,
    p.teamId,
    p.node,
    p.edge && `${p.edge.from} ${p.edge.kind} ${p.edge.to}`
  )

/**
 * The L1/L2/L3 hierarchy as an indented, collapsible tree. Ordered by the
 * order the server sent, which is `sort_key` — never by code, because
 * lexically `2.10` sorts before `2.9` and at this granularity ten children is
 * the common case rather than the edge case.
 *
 * One tree, used by the Processes page and by the `process-tree` widget.
 */
export function ProcessTree({
  processes,
  openToLevel = 1,
  showOwner = true,
}: {
  processes: Process[]
  /** Levels at or below this start expanded. 1 shows the stages of each L1. */
  openToLevel?: number
  showOwner?: boolean
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  // Keyed on which processes are here, not on the array's identity. The widget
  // fetches `/processes` through the shared scope params, so touching any
  // control in the filter row — none of which `/processes` reads — produced a
  // new array of byte-identical rows and threw away whatever the reader had
  // collapsed. Newly seen processes open to `openToLevel`; everything already
  // on screen keeps the state the reader put it in.
  const shape = useMemo(() => processes.map((p) => p.id).join(','), [processes])
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev)
      for (const p of processes) {
        if (seen.current.has(p.id)) continue
        seen.current.add(p.id)
        if (p.level <= openToLevel) next.add(p.id)
      }
      return next
    })
    // `shape` stands in for `processes`: same ids, same tree, no reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, openToLevel])

  // A change to how far to open is a deliberate instruction, so it does start
  // over — that is what the Stages/Actions control on /processes is for.
  const level = useRef(openToLevel)
  useEffect(() => {
    if (level.current === openToLevel) return
    level.current = openToLevel
    seen.current = new Set(processes.map((p) => p.id))
    setOpen(new Set(processes.filter((p) => p.level <= openToLevel).map((p) => p.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openToLevel])

  // A search keeps a tree a tree: what matched, the way down to it, and what
  // is beneath it — so a hit on "Order and execution" still opens onto its
  // parts, and a hit on an L3 arrives with the L1 and L2 it belongs to.
  const byId = useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes])
  const found = useMemo(() => {
    if (!q) return null
    const hits = new Set(processes.filter((p) => processText(p).toLowerCase().includes(q)).map((p) => p.id))
    const up = new Set<string>()
    for (const id of hits) {
      for (let a = byId.get(id)?.parentId; a && byId.has(a) && !up.has(a); a = byId.get(a)!.parentId) up.add(a)
    }
    const down = new Set<string>()
    for (const p of processes) {
      for (let a = p.parentId; a && byId.has(a); a = byId.get(a)!.parentId) {
        if (hits.has(a)) {
          down.add(p.id)
          break
        }
      }
    }
    return { hits, up, down }
  }, [q, processes, byId])

  // The way down to every hit opens, so a hit is on screen rather than folded
  // under a collapsed L1. What the reader opens or closes after that is theirs.
  useEffect(() => {
    if (found) setOpen((prev) => new Set([...prev, ...found.up]))
  }, [found])

  const visible = found
    ? processes.filter((p) => found.hits.has(p.id) || found.up.has(p.id) || found.down.has(p.id))
    : processes

  const children = useMemo(() => {
    const by = new Map<string, Process[]>()
    const ids = new Set(visible.map((p) => p.id))
    for (const p of visible) {
      // A root here is anything whose parent is not in this slice, so a
      // widget rooted at 2.1 renders 2.1 at the top rather than nothing.
      const key = p.parentId && ids.has(p.parentId) ? p.parentId : '·root'
      if (!by.has(key)) by.set(key, [])
      by.get(key)!.push(p)
    }
    return by
  }, [visible])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Counted over what was asked for: a filter row's context rows are there to
  // hold the tree up, and are not processes the reader is looking for.
  const asked = processes.filter((p) => !p.context)
  return (
    <div className="proc-tree-wrap">
      <ListSearch
        query={query}
        onChange={setQuery}
        shown={found ? asked.filter((p) => found.hits.has(p.id)).length : asked.length}
        total={asked.length}
        noun="processes"
        label="Search processes"
      />
      {visible.length ? (
        <ul className="proc-tree">
          {(children.get('·root') ?? []).map((p) => (
            <Branch
              key={p.id}
              process={p}
              children={children}
              open={open}
              onToggle={toggle}
              showOwner={showOwner}
              q={q}
            />
          ))}
        </ul>
      ) : (
        <NoMatch query={query} />
      )}
    </div>
  )
}

/** Every parent id, so a page can offer "expand all". */
export const allParents = (processes: Process[]) =>
  processes.filter((p) => p.childCount > 0).map((p) => p.id)

function Branch({
  process,
  children,
  open,
  onToggle,
  showOwner,
  q,
}: {
  process: Process
  children: Map<string, Process[]>
  open: Set<string>
  onToggle: (id: string) => void
  showOwner: boolean
  /** The search, lower-cased; marked where it occurs so a hit says why. */
  q: string
}) {
  const kids = children.get(process.id) ?? []
  const expanded = open.has(process.id)

  return (
    <li className={`proc-row level-${process.level}${process.context ? ' context' : ''}`}>
      {/* A context row is an ancestor of what a filter asked for, there so the
          tree stays a tree. It says so, rather than leaving the reader to
          wonder why it is grey. */}
      <div
        className="proc-line"
        title={process.context ? "Not in this page's filter — shown for what is beneath it" : undefined}
      >
        {kids.length ? (
          <button
            type="button"
            className="proc-twisty"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${process.name}` : `Expand ${process.name}`}
            onClick={() => onToggle(process.id)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="proc-twisty" aria-hidden="true" />
        )}

        <Link to={processHref(process.pack, process.code)} className="proc-code">
          <Highlight text={displayCode(process.code)} q={q} />
        </Link>
        <Link to={processHref(process.pack, process.code)} className="proc-name">
          <Highlight text={process.name} q={q} />
        </Link>

        {/* Only at the top. Every row under it is in the same pack, and
            repeating it down the tree would be noise on every line. */}
        {process.level === 1 && <span className="muted proc-pack">{process.pack}</span>}

        {/* "2 of 5" when a filter has thinned them: a process listed with two
            parts is a different process unless it says it has five. */}
        {kids.length > 0 && (
          <span className="muted proc-count">
            {kids.length < process.childCount ? `${kids.length} of ${process.childCount}` : kids.length}{' '}
            {process.childCount === 1 ? 'part' : 'parts'}
          </span>
        )}

        {/* A leaf is where the work is, so it shows what it happens at. */}
        {!kids.length && process.node && (
          <span className="proc-at">
            {process.unresolved.node ? (
              <span className="proc-missing" title="No such component in the map">
                {idValue(process.node)}
              </span>
            ) : (
              <Link to={nodeHref(process.node)}>
                <Highlight text={idValue(process.node)} q={q} />
              </Link>
            )}
          </span>
        )}

        {showOwner && process.owner && (
          <span className="muted proc-owner">
            <Highlight text={process.owner} q={q} />
          </span>
        )}
        {process.optional && <span className="pill">optional</span>}
        <MatchedIn
          q={q}
          shown={[
            displayCode(process.code),
            process.name,
            process.level === 1 && process.pack,
            !kids.length && process.node && idValue(process.node),
            showOwner && process.owner,
          ]}
          hidden={[
            ['Team', process.teamName],
            ['Owner', process.owner],
            ['Pack', process.pack],
            ['At', process.node],
            ['Over', process.edge && `${process.edge.from} ${process.edge.kind} ${process.edge.to}`],
          ]}
        />
      </div>

      {expanded && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <Branch
              key={k.id}
              process={k}
              children={children}
              open={open}
              onToggle={onToggle}
              showOwner={showOwner}
              q={q}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
