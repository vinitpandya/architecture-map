import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Process } from '../lib/api'
import { displayCode, idValue, nodeHref, processHref } from '../lib/nodes'

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

  useEffect(() => {
    setOpen(new Set(processes.filter((p) => p.level <= openToLevel).map((p) => p.id)))
  }, [processes, openToLevel])

  const children = useMemo(() => {
    const by = new Map<string, Process[]>()
    const ids = new Set(processes.map((p) => p.id))
    for (const p of processes) {
      // A root here is anything whose parent is not in this slice, so a
      // widget rooted at 2.1 renders 2.1 at the top rather than nothing.
      const key = p.parentId && ids.has(p.parentId) ? p.parentId : '·root'
      if (!by.has(key)) by.set(key, [])
      by.get(key)!.push(p)
    }
    return by
  }, [processes])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <ul className="proc-tree">
      {(children.get('·root') ?? []).map((p) => (
        <Branch key={p.id} process={p} children={children} open={open} onToggle={toggle} showOwner={showOwner} />
      ))}
    </ul>
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
}: {
  process: Process
  children: Map<string, Process[]>
  open: Set<string>
  onToggle: (id: string) => void
  showOwner: boolean
}) {
  const kids = children.get(process.id) ?? []
  const expanded = open.has(process.id)

  return (
    <li className={`proc-row level-${process.level}`}>
      <div className="proc-line">
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

        <Link to={processHref(process.code)} className="proc-code">
          {displayCode(process.code)}
        </Link>
        <Link to={processHref(process.code)} className="proc-name">
          {process.name}
        </Link>

        {kids.length > 0 && (
          <span className="muted proc-count">
            {kids.length} {kids.length === 1 ? 'part' : 'parts'}
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
              <Link to={nodeHref(process.node)}>{idValue(process.node)}</Link>
            )}
          </span>
        )}

        {showOwner && process.owner && <span className="muted proc-owner">{process.owner}</span>}
        {process.optional && <span className="pill">optional</span>}
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
            />
          ))}
        </ul>
      )}
    </li>
  )
}
