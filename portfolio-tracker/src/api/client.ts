import type { HistoryInterval, HistoryRange, HistoryResponse, PortfolioSnapshot, ValueHistoryResponse } from '../types'

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} responded ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchPositions = (signal?: AbortSignal) => getJson<PortfolioSnapshot>('/api/positions', signal)

export function fetchHistory(
  symbol: string, range: HistoryRange, interval: HistoryInterval, signal?: AbortSignal,
): Promise<HistoryResponse> {
  const qs = new URLSearchParams({ range, interval })
  return getJson<HistoryResponse>(`/api/history/${encodeURIComponent(symbol)}?${qs}`, signal)
}

export function fetchValueHistory(currency: string, range: HistoryRange, signal?: AbortSignal): Promise<ValueHistoryResponse> {
  const qs = new URLSearchParams({ range, currency })
  return getJson<ValueHistoryResponse>(`/api/portfolio/value?${qs}`, signal)
}
