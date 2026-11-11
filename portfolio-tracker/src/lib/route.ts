export type Tab = 'dashboard' | 'holdings' | 'ledger' | 'connections'

const PATHS: Record<Tab, string> = { dashboard: '#/', holdings: '#/holdings', ledger: '#/ledger', connections: '#/connections' }

/** The tab's hash, with an optional query (`#/holdings?symbol=RY.TO`). */
export function hashFor(tab: Tab, params?: Record<string, string>): string {
  const qs = params ? new URLSearchParams(params).toString() : ''
  return qs ? `${PATHS[tab]}?${qs}` : PATHS[tab]
}

/** `#/connections?linked=questrade` -> the tab plus its query (broker sign-ins report back there). */
export function parseHash(hash: string): { tab: Tab; params: URLSearchParams } {
  const q = hash.indexOf('?')
  const path = q === -1 ? hash : hash.slice(0, q)
  const tab = (Object.keys(PATHS) as Tab[]).find((t) => t !== 'dashboard' && PATHS[t] === path) ?? 'dashboard'
  return { tab, params: new URLSearchParams(q === -1 ? '' : hash.slice(q + 1)) }
}
