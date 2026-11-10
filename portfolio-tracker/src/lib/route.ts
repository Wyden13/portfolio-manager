export type Tab = 'dashboard' | 'ledger' | 'connections'

const PATHS: Record<Tab, string> = { dashboard: '#/', ledger: '#/ledger', connections: '#/connections' }

export const hashFor = (tab: Tab) => PATHS[tab]

/** `#/connections?linked=questrade` -> the tab plus its query (broker sign-ins report back there). */
export function parseHash(hash: string): { tab: Tab; params: URLSearchParams } {
  const q = hash.indexOf('?')
  const path = q === -1 ? hash : hash.slice(0, q)
  const tab = (Object.keys(PATHS) as Tab[]).find((t) => t !== 'dashboard' && PATHS[t] === path) ?? 'dashboard'
  return { tab, params: new URLSearchParams(q === -1 ? '' : hash.slice(q + 1)) }
}
