import { num } from './format'

/** Gridline spacing: 1, 2, 2.5 or 5 times a power of ten, so at most `lines` steps span the data. */
export function niceStep(span: number, lines = 4): number {
  if (!(span > 0)) return 1
  const raw = span / lines
  const pow = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw) return m * pow
  }
  return 10 * pow
}

export interface GridLine {
  /** y in plot units (0 = top) */
  y: number
  /** the same, as a percentage of the plot height, for HTML labels beside the SVG */
  pct: number
  label: string
}

export interface Plot {
  width: number
  height: number
  grid: GridLine[]
  /** SVG path of the series, and the same closed down to the bottom for the fill. */
  line: string
  area: string
  /** y of a value, or null when it falls outside the gridlines. */
  yOf: (value: number) => number | null
  /** x of the i-th point. */
  xOf: (i: number) => number
}

/**
 * Scale a series into a `width` x `height` box (the design's 800 x 220 viewBox, stretched with
 * preserveAspectRatio="none"), with round-number gridlines just outside the data's range.
 */
export function plotSeries(values: number[], width = 800, height = 220, lines = 4): Plot {
  const vmax = Math.max(...values)
  const vmin = Math.min(...values)
  const span = vmax - vmin || Math.abs(vmax) * 0.02 || 1
  const step = niceStep(span, lines)
  let top = Math.ceil(vmax / step) * step
  let bot = Math.floor(vmin / step) * step
  if (top === bot) { top += step; bot -= step }
  const Y = (v: number) => ((top - v) / (top - bot)) * height
  const n = values.length
  const xOf = (i: number) => (n <= 1 ? 0 : (i * width) / (n - 1))
  const digits = step < 1 ? 2 : 0
  const grid: GridLine[] = []
  for (let v = bot; v <= top + step / 1e6; v += step) {
    const y = Y(v)
    grid.push({ y, pct: (y / height) * 100, label: num(v, digits) })
  }
  const pts = (n === 1 ? [values[0], values[0]] : values)
    .map((v, i) => `${i ? 'L' : 'M'}${(n === 1 ? i * width : xOf(i)).toFixed(1)} ${Y(v).toFixed(1)}`)
    .join(' ')
  return {
    width, height, grid,
    line: pts,
    area: `${pts} L${width} ${height} L0 ${height} Z`,
    yOf: (v) => (v < bot || v > top ? null : Y(v)),
    xOf,
  }
}

/** Up to `count` evenly spaced indices from 0 to n - 1, first and last included. */
export function tickIndices(n: number, count: number): number[] {
  if (n <= 0) return []
  if (n <= count) return [...Array(n).keys()]
  return [...new Set([...Array(count).keys()].map((k) => Math.round((k * (n - 1)) / (count - 1))))]
}

/** Index of the point nearest to a fraction (0..1) of the plot's width. */
export const nearestIndex = (fraction: number, n: number) =>
  Math.min(n - 1, Math.max(0, Math.round(fraction * (n - 1))))
