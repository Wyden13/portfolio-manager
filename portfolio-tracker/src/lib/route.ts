export type Tab = 'landing' | 'portfolio' | 'holdings' | 'markets' | 'accounts' | 'news' | 'holding' | 'connect'

const PATHS: Record<Tab, string> = {
  landing: '#/',
  portfolio: '#/portfolio',
  holdings: '#/holdings',
  markets: '#/markets',
  accounts: '#/accounts',
  news: '#/news',
  holding: '#/holding',
  connect: '#/connect',
}

/**
 * Hashes of the previous layout, kept working: bookmarks, and the backend, which still sends broker
 * sign-ins back to #/connections?linked=…
 */
const ALIASES: Record<string, { tab: Tab; params?: Record<string, string> }> = {
  '#/ledger': { tab: 'accounts', params: { view: 'history' } },
  '#/connections': { tab: 'connect' },
}

export interface Route { tab: Tab; params: URLSearchParams }

/** The tab's hash, with an optional query (`#/holding?symbol=RY.TO`). */
export function hashFor(tab: Tab, params?: Record<string, string>): string {
  const qs = params ? new URLSearchParams(params).toString() : ''
  return qs ? `${PATHS[tab]}?${qs}` : PATHS[tab]
}

/** `#/connect?linked=questrade` -> the tab plus its query; unknown paths are the landing page. */
export function parseHash(hash: string): Route {
  const q = hash.indexOf('?')
  const path = q === -1 ? hash : hash.slice(0, q)
  const params = new URLSearchParams(q === -1 ? '' : hash.slice(q + 1))
  const alias = ALIASES[path]
  if (alias) {
    for (const [k, v] of Object.entries(alias.params ?? {})) params.set(k, v)
    return { tab: alias.tab, params }
  }
  // The old holdings drawer (#/holdings?symbol=X) is now the holding page.
  if (path === PATHS.holdings && params.has('symbol')) return { tab: 'holding', params }
  const tab = (Object.keys(PATHS) as Tab[]).find((t) => t !== 'landing' && PATHS[t] === path) ?? 'landing'
  return { tab, params }
}

/** Where a symbol's page is. */
export const holdingHash = (symbol: string) => hashFor('holding', { symbol })
