/**
 * Palette access for the charts.
 *
 * Categorical hues are assigned in fixed slot order and keyed by *entity id*, so
 * filtering a series out never repaints the survivors. Ordinal ramps are the
 * validated blue steps — light mode tops out at 5 steps (a 6th cannot clear the
 * adjacent-lightness gate against the light surface), so both modes use at most
 * 5 bands and anything beyond that folds into "Other".
 */

export const CATEGORICAL_SLOTS = 8
export const MAX_ORDINAL_STEPS = 5

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Slot n (1-based) as a CSS var reference — resolves per theme automatically. */
export function seriesVar(index: number): string {
  return `var(--series-${(index % CATEGORICAL_SLOTS) + 1})`
}

/** Validated ordinal blue ramps, light→dark, by step count. */
const ORDINAL_LIGHT: Record<number, string[]> = {
  1: ['--blue-450'],
  2: ['--blue-250', '--blue-700'],
  3: ['--blue-250', '--blue-450', '--blue-700'],
  4: ['--blue-250', '--blue-400', '--blue-550', '--blue-700'],
  5: ['--blue-250', '--blue-350', '--blue-450', '--blue-550', '--blue-700'],
}

const ORDINAL_DARK: Record<number, string[]> = {
  1: ['--blue-400'],
  2: ['--blue-100', '--blue-600'],
  3: ['--blue-100', '--blue-350', '--blue-600'],
  4: ['--blue-100', '--blue-250', '--blue-400', '--blue-600'],
  5: ['--blue-100', '--blue-200', '--blue-300', '--blue-450', '--blue-600'],
}

export function isDark(): boolean {
  const stamped = document.documentElement.dataset.theme
  if (stamped === 'dark') return true
  if (stamped === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * `n` ordered steps, lightest first. Callers reverse it when the darkest band
 * belongs at the bottom of a stack.
 */
export function ordinalRamp(n: number, dark = isDark()): string[] {
  const count = Math.max(1, Math.min(n, MAX_ORDINAL_STEPS))
  const table = dark ? ORDINAL_DARK : ORDINAL_LIGHT
  return table[count].map((v) => `var(${v})`)
}

/** Stable entity → slot map, assigned in first-seen (ranked) order. */
export function makeColorScale(ids: string[]) {
  const map = new Map<string, string>()
  ids.forEach((id, i) => map.set(id, seriesVar(i)))
  return (id: string) => map.get(id) ?? 'var(--text-muted)'
}

/** Resolve a `var(--x)` reference to a concrete hex — needed for canvas/opacity math. */
export function resolve(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color)
  return m ? cssVar(m[1]) : color
}

function toRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '')
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (s.length !== 6) return null
  const n = Number.parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relLum([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/**
 * A label sitting *inside* a coloured fill is the one place text may leave the
 * ink tokens. Composite the fill over the chart surface and return whichever of
 * white/near-black actually clears contrast against it.
 */
export function inkOn(color: string, alpha = 1): string {
  const fg = toRgb(resolve(color))
  const bg = toRgb(resolve('var(--surface-1)'))
  if (!fg || !bg) return 'var(--text-primary)'
  const mix = fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as [number, number, number]
  const L = relLum(mix)
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#0b0b0b'
}

export const CATEGORY_LABEL: Record<string, string> = {
  new: 'To do',
  indeterminate: 'In progress',
  done: 'Done',
}
