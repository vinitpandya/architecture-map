import { useState, type ReactNode } from 'react'

/**
 * The search every list carries, grid or not: case-insensitive, over whatever
 * text the list says an item is found by. Not remembered — a filter that
 * survived a reload would read as missing data.
 */
export function useSearch<T>(items: T[], text: (item: T) => string) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  // Not memoised: `text` is written inline at every call site, and these
  // lists are tens of rows, not thousands.
  const matches = q ? items.filter((item) => text(item).toLowerCase().includes(q)) : items
  return { query, setQuery, q, matches, narrowed: q !== '' }
}

/** The text an item is found by, from whatever parts of it are set. */
export const textOf = (...parts: unknown[]) =>
  parts.filter((p) => p !== null && p !== undefined && p !== '').join(' ')

/** Every string and number inside a value — a finding's `data`, say — and none of its keys. */
export function valuesOf(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(valuesOf)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(valuesOf)
  return []
}

/**
 * The box and its count. Escape clears it and stops there; only an empty box
 * lets Escape go on to whatever is listening above — a full-screen widget
 * closes on it, and clearing a search must not exit the screen.
 */
export function SearchBox({
  query,
  onChange,
  shown,
  total,
  noun,
  label,
}: {
  query: string
  onChange: (next: string) => void
  shown: number
  total: number
  /** What is being counted, plural: "3 of 12 rows". */
  noun: string
  label: string
}) {
  return (
    <>
      <input
        type="search"
        value={query}
        placeholder="Search…"
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            onChange('')
            e.stopPropagation()
          }
        }}
      />
      {/* Always mounted, so the live region exists before it has anything
          to say; a region that appears already holding its text is read
          as nothing. */}
      <span className="search-count" aria-live="polite" aria-atomic="true">
        {query.trim() ? `${shown} of ${total} ${noun}` : ''}
      </span>
    </>
  )
}

/** The box above a list that is not a DataGrid, where a grid's toolbar would be. */
export function ListSearch(props: Parameters<typeof SearchBox>[0]) {
  return (
    <div className="list-toolbar">
      <SearchBox {...props} />
    </div>
  )
}

/** A search matching nothing says so, and the box stays above it to change. */
export function NoMatch({ query }: { query: string }) {
  return <p className="muted no-match">Nothing matches “{query.trim()}”</p>
}

/** The first place `q` occurs in `text`, marked — so a hit says why it is one. */
export function Highlight({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text
  const at = text.toLowerCase().indexOf(q)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

/**
 * Why a hit is one, when what matched is not on the row: the first field the
 * row does not show that holds the search, labelled and marked. Searching
 * "matching" keeps a part whose outcome is "…the matching engine has it", and
 * without this the row reads as a hit with no reason.
 */
export function MatchedIn({
  q,
  shown,
  hidden,
}: {
  q: string
  /** What the row already displays; a match there needs no explaining. */
  shown: (string | null | undefined | false)[]
  hidden: [label: string, value: string | null | undefined][]
}) {
  if (!q || shown.some((t) => t && t.toLowerCase().includes(q))) return null
  const hit = hidden.find(([, v]) => v && v.toLowerCase().includes(q))
  if (!hit) return null
  return (
    <span className="matched-in muted">
      {hit[0]}: <Highlight text={hit[1]!} q={q} />
    </span>
  )
}
