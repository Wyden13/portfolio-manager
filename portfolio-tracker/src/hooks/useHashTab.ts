import { useCallback, useEffect, useState } from 'react'
import { hashFor, parseHash, type Tab } from '../lib/route'

export type { Tab }

const tabFromHash = (): Tab => parseHash(window.location.hash).tab

/** The open tab, kept in the URL hash (#/ledger) so reloads and the back button work. */
export function useHashTab(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  useEffect(() => {
    const onChange = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const open = useCallback((next: Tab) => {
    window.location.hash = hashFor(next)
  }, [])
  return [tab, open]
}
