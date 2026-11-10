import type { CurrencyTotal, PortfolioSnapshot, Position } from '../types'

export interface PricedPosition extends Position {
  market_value: number
  unrealized_pnl: number
  unrealized_pct: number
}

export const isPriced = (p: Position): p is PricedPosition =>
  p.status === 'ok' && p.market_value !== null && p.unrealized_pnl !== null && p.unrealized_pct !== null

export function currenciesOf(snapshot: PortfolioSnapshot): string[] {
  return [...new Set(snapshot.positions.map((p) => p.currency))].sort()
}

/** Priced positions in one currency. Charts never mix currencies, so callers always filter first. */
export function pricedIn(snapshot: PortfolioSnapshot, currency: string): PricedPosition[] {
  return snapshot.positions.filter((p) => p.currency === currency).filter(isPriced)
}

export function totalFor(snapshot: PortfolioSnapshot, currency: string): CurrencyTotal | undefined {
  return snapshot.totals.find((t) => t.currency === currency)
}

export type AllocationBy = 'holding' | 'account'

export interface Slice {
  name: string
  value: number
}

export function allocation(positions: PricedPosition[], by: AllocationBy): Slice[] {
  const sums = new Map<string, number>()
  for (const p of positions) {
    const key = by === 'holding' ? p.symbol : `Account ${p.account_id}`
    sums.set(key, (sums.get(key) ?? 0) + p.market_value)
  }
  return [...sums].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

/** Sorted by unrealized P&L, biggest loss first so the bars read left to right as a ranking. */
export function gainLossRanking(positions: PricedPosition[]): PricedPosition[] {
  return [...positions].sort((a, b) => a.unrealized_pnl - b.unrealized_pnl)
}

export const positionKey = (p: Pick<Position, 'account_id' | 'symbol'>) => `${p.account_id}:${p.symbol}`
