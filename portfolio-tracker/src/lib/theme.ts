// Colours live in index.css as tokens for both themes; this only picks and remembers the theme.
export type Theme = 'light' | 'dark'

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
