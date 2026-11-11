import { useCallback, useEffect, useState } from 'react'
import { hashFor, parseHash, type Tab } from '../lib/route'

export type { Tab }

const tabFromHash = (): Tab => parseHash(window.location.hash).tab

/** One query parameter of the hash (`#/holdings?symbol=RY.TO` -> 'RY.TO'), following hash changes. */
export function useHashParam(name: string): string | null {
  const read = useCallback(() => parseHash(window.location.hash).params.get(name), [name])
  const [value, setValue] = useState<string | null>(read)
  useEffect(() => {
    const onChange = () => setValue(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [read])
  return value
}

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
