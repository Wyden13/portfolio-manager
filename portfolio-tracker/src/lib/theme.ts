export type Theme = 'light' | 'dark'

export interface Palette {
  text: string
  muted: string
  grid: string
  surface: string
  accent: string
  gain: string
  loss: string
  series: string[]
  candleUp: string
  candleDown: string
}

const SERIES = ['#3b82f6', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#06b6d4', '#a855f7', '#64748b']

export const PALETTES: Record<Theme, Palette> = {
  light: {
    text: '#1c2230', muted: '#5d6678', grid: '#e3e6ec', surface: '#ffffff', accent: '#2563eb',
    gain: '#13803f', loss: '#c0392b', series: SERIES, candleUp: '#13803f', candleDown: '#c0392b',
  },
  dark: {
    text: '#e6e9f0', muted: '#9aa3b5', grid: '#2a3142', surface: '#161b27', accent: '#6ea0ff',
    gain: '#3ecf86', loss: '#ff6b6b', series: SERIES, candleUp: '#3ecf86', candleDown: '#ff6b6b',
  },
}

export function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage can be blocked; fall through to the OS preference */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem('theme', theme)
  } catch {
    /* ignore */
  }
}

// Treemap tiles: white labels sit on all of these at >= 4.5:1 contrast, in both themes.
type Rgb = [number, number, number]
const NEUTRAL: Rgb = [0x5b, 0x65, 0x77]
const GAIN: [Rgb, Rgb] = [[0x2e, 0x7d, 0x4f], [0x12, 0x5a, 0x32]] // small -> large gain
const LOSS: [Rgb, Rgb] = [[0xb8, 0x4a, 0x40], [0x8c, 0x1c, 0x17]] // small -> large loss
const FLAT_PCT = 0.5
const FULL_SCALE_PCT = 20

/** Diverging scale without a muddy middle: grey only when flat, otherwise a shade of green/red. */
export function tileColor(pct: number): string {
  if (Math.abs(pct) < FLAT_PCT) return `rgb(${NEUTRAL.join(', ')})`
  const [from, to] = pct > 0 ? GAIN : LOSS
  const k = Math.min(Math.abs(pct) / FULL_SCALE_PCT, 1)
  const c = from.map((n, i) => Math.round(n + (to[i] - n) * k))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
