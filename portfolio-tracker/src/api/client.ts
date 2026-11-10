import type { HistoryInterval, HistoryRange, HistoryResponse, PortfolioSnapshot, ValueHistoryResponse } from '../types'
import { mockHistory, mockSnapshot, mockValueHistory } from './mock'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchPositions = (signal?: AbortSignal) => getJson<PortfolioSnapshot>('/api/positions', signal)

const useRealHistory = import.meta.env.VITE_REAL_HISTORY === 'true'

export async function fetchHistory(
  symbol: string, range: HistoryRange, interval: HistoryInterval, signal?: AbortSignal,
): Promise<HistoryResponse> {
  if (useRealHistory) {
    const qs = new URLSearchParams({ range, interval })
    return getJson<HistoryResponse>(`/api/history/${encodeURIComponent(symbol)}?${qs}`, signal)
  }
  return mockHistory(symbol, range, interval)
}

export async function fetchValueHistory(
  currency: string, range: HistoryRange, signal?: AbortSignal,
): Promise<ValueHistoryResponse> {
  if (useRealHistory) {
    const qs = new URLSearchParams({ range, currency })
    return getJson<ValueHistoryResponse>(`/api/portfolio/value?${qs}`, signal)
  }
  const total = mockSnapshot().totals.find((t) => t.currency === currency)
  return mockValueHistory(currency, range, total?.market_value ?? 0)
}
