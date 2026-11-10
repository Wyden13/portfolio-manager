import { useCallback, useEffect, useState } from 'react'

export type Tab = 'dashboard' | 'ledger'

const tabFromHash = (): Tab => (window.location.hash === '#/ledger' ? 'ledger' : 'dashboard')

/** The open tab, kept in the URL hash (#/ledger) so reloads and the back button work. */
export function useHashTab(): [Tab, (tab: Tab) => void] {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  useEffect(() => {
    const onChange = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const open = useCallback((next: Tab) => {
    window.location.hash = next === 'ledger' ? '#/ledger' : '#/'
  }, [])
  return [tab, open]
}
