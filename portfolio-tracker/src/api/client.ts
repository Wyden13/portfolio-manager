import type { HistoryInterval, HistoryRange, HistoryResponse, PortfolioSnapshot, ValueHistoryResponse } from '../types'
import { mockHistory, mockValueHistory } from './mock'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchPositions = (signal?: AbortSignal) => getJson<PortfolioSnapshot>('/api/positions', signal)

// The history endpoints don't exist in the backend yet (see TODO.md). Until they do the adapter
// serves deterministic mock data; set VITE_REAL_HISTORY=true to call the real contract instead.
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
  currency: string, range: HistoryRange, currentValue: number, signal?: AbortSignal,
): Promise<ValueHistoryResponse> {
  if (useRealHistory) {
    const qs = new URLSearchParams({ range, currency })
    return getJson<ValueHistoryResponse>(`/api/portfolio/value?${qs}`, signal)
  }
  return mockValueHistory(currency, range, currentValue)
}
