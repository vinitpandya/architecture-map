/** Compact for display, full precision in tables. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (abs >= 10_000) return `${trim(n / 1000)}K`
  return trim(n)
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? r.toLocaleString() : r.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

export function full(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function metricLabel(metric: string): string {
  return { count: 'issues', points: 'points', timespent: 'hours' }[metric] ?? metric
}

export function formatMetric(n: number, metric: string): string {
  if (metric === 'timespent') return `${compact(n)}h`
  return compact(n)
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const DAY_YEAR_FMT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export function shortDate(d: Date | string): string {
  return DAY_FMT.format(typeof d === 'string' ? new Date(d) : d)
}
export function longDate(d: Date | string): string {
  return DAY_YEAR_FMT.format(typeof d === 'string' ? new Date(d) : d)
}

export function relative(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
