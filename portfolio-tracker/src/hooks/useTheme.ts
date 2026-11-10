import { useCallback, useEffect, useState } from 'react'
import { readStoredTheme, storeTheme, type Theme } from '../lib/theme'

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      storeTheme(next)
      return next
    })
  }, [])

  return [theme, toggle]
}
