import { useCallback, useEffect, useState } from 'react'
import { hashFor, parseHash, type Route, type Tab } from '../lib/route'

export type { Tab }

const current = (): Route => parseHash(window.location.hash)

/** The open page and its query, kept in the URL hash (#/accounts?view=history) so reloads and Back work. */
export function useRoute(): [Route, (tab: Tab, params?: Record<string, string>) => void] {
  const [route, setRoute] = useState<Route>(current)
  useEffect(() => {
    const onChange = () => setRoute(current())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const open = useCallback((tab: Tab, params?: Record<string, string>) => {
    window.location.hash = hashFor(tab, params)
  }, [])
  return [route, open]
}
