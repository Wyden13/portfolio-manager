import type {
  AccountValueHistoryResponse, BrokerageCatalog, ConnectionsOverview, HistoryInterval, HistoryRange, HistoryResponse, LedgerPage, LinkedAccount, Platform,
  PortfolioSnapshot, SecurityProfile, TransactionKind,
} from '../types'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  return res.json() as Promise<T>
}

/** A failed request, carrying the server's message (`detail`) and machine-readable `code` when it sent one. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function send<T>(method: 'POST' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({})) as { detail?: unknown; code?: string }
    const detail = typeof error.detail === 'string' ? error.detail : `${url} responded ${res.status}`
    throw new ApiError(detail, res.status, error.code)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export const fetchPositions = (signal?: AbortSignal) => getJson<PortfolioSnapshot>('/api/positions', signal)

export function fetchHistory(
  symbol: string, range: HistoryRange, interval: HistoryInterval, signal?: AbortSignal,
): Promise<HistoryResponse> {
  const qs = new URLSearchParams({ range, interval })
  return getJson<HistoryResponse>(`/api/history/${encodeURIComponent(symbol)}?${qs}`, signal)
}

export function fetchAccountValueHistory(range: HistoryRange, signal?: AbortSignal): Promise<AccountValueHistoryResponse> {
  return getJson<AccountValueHistoryResponse>(`/api/portfolio/value/accounts?${new URLSearchParams({ range })}`, signal)
}

export const fetchProfiles = (signal?: AbortSignal) =>
  getJson<Record<string, SecurityProfile>>('/api/holdings/profiles', signal)

export const fetchAccounts = (signal?: AbortSignal) => getJson<LinkedAccount[]>('/api/ledger/accounts', signal)

export interface LedgerQuery {
  institution?: string
  accountId?: number
  kinds: TransactionKind[]
  symbol?: string
  /** YYYY-MM-DD, inclusive */
  start?: string
  end?: string
}

/** Query string shared by the ledger page and its CSV export. */
export function ledgerParams(q: LedgerQuery): URLSearchParams {
  const qs = new URLSearchParams()
  if (q.institution) qs.set('institution', q.institution)
  if (q.accountId !== undefined) qs.set('account_id', String(q.accountId))
  q.kinds.forEach((k) => qs.append('kind', k))
  if (q.symbol?.trim()) qs.set('symbol', q.symbol.trim())
  if (q.start) qs.set('start', q.start)
  if (q.end) qs.set('end', q.end)
  return qs
}

export function fetchLedger(q: LedgerQuery, limit: number, offset: number, signal?: AbortSignal): Promise<LedgerPage> {
  const qs = ledgerParams(q)
  qs.set('limit', String(limit))
  qs.set('offset', String(offset))
  return getJson<LedgerPage>(`/api/transactions?${qs}`, signal)
}

export const ledgerCsvUrl = (q: LedgerQuery) => `/api/transactions.csv?${ledgerParams(q)}`

export const fetchConnections = (signal?: AbortSignal) => getJson<ConnectionsOverview>('/api/connections/overview', signal)

export const fetchBrokerages = (signal?: AbortSignal) => getJson<BrokerageCatalog>('/api/brokerages', signal)

/** Full-page navigation target: starts Questrade's OAuth sign-in, which returns to #/connections. */
export const QUESTRADE_SIGN_IN_URL = '/api/questrade/connect'

export const connectQuestradeToken = (refreshToken: string) =>
  send<unknown>('POST', '/api/questrade/token', { refresh_token: refreshToken })

export interface SnapTradePortalOptions {
  /** SnapTrade broker slug to preselect, e.g. WEALTHSIMPLE */
  broker?: string
  /** Repair this already linked institution instead of adding one. */
  reconnectInstitution?: string
}

export async function snapTradePortalUrl(opts: SnapTradePortalOptions): Promise<string> {
  const body = await send<{ redirect_uri: string }>('POST', '/api/snaptrade/connect', {
    broker: opts.broker, reconnect_institution: opts.reconnectInstitution,
  })
  return body.redirect_uri
}

export const syncPlatform = (platform: Platform) => send<unknown>('POST', `/api/sync/${platform}`)

export function disconnect(platform: Platform, institution?: string): Promise<void> {
  const qs = institution ? `?${new URLSearchParams({ institution })}` : ''
  return send<void>('DELETE', `/api/connections/${platform}${qs}`)
}
