import type { AssetClass, CurrencyTotal, PortfolioSnapshot, Position } from '../types'

export interface PricedPosition extends Position {
  market_value: number
  unrealized_pnl: number
  unrealized_pct: number
}

export const isPriced = (p: Position): p is PricedPosition =>
  p.status === 'ok' && p.market_value !== null && p.unrealized_pnl !== null && p.unrealized_pct !== null

export interface ValuedPosition extends Position {
  market_value: number
}

/** Has a live value, with or without P&L (holdings without a broker cost basis have no P&L). */
export const isValued = (p: Position): p is ValuedPosition =>
  (p.status === 'ok' || p.status === 'no_cost') && p.market_value !== null

/** Valued positions in one currency, for value charts (treemap, allocation). */
export function valuedIn(snapshot: PortfolioSnapshot, currency: string): ValuedPosition[] {
  return snapshot.positions.filter((p) => p.currency === currency).filter(isValued)
}

/** Explains a position's cost figures for tooltips; empty when they come from your own trades. */
export function costNote(p: Position): string {
  if (p.status === 'no_cost') return 'No cost basis reported by the broker'
  return p.source === 'broker' ? 'Cost basis reported by the broker' : ''
}

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

export const GROUPINGS = ['holding', 'account', 'class', 'currency'] as const
export type AllocationBy = typeof GROUPINGS[number]
export const GROUP_LABEL: Record<AllocationBy, string> = { holding: 'Holding', account: 'Account', class: 'Class', currency: 'Currency' }

export interface Slice {
  name: string
  value: number
}

export type AccountLabel = (accountId: number) => string

export const CASH_LABEL = 'Cash'
export const ASSET_CLASS_LABEL: Record<AssetClass, string> = { stock: 'Stocks', etf: 'ETFs', fund: 'Funds', other: 'Other' }

/**
 * Everything held, holdings and cash, in the base currency at the snapshot's spot rates, grouped by
 * `by`. Amounts in a currency without a rate are left out, and so is negative cash (a margin
 * balance), which a share of the whole can't show.
 */
export function allocation(snapshot: PortfolioSnapshot, by: AllocationBy, accountLabel: AccountLabel): Slice[] {
  const sums = new Map<string, number>()
  const add = (key: string, amount: number, currency: string) => {
    const rate = snapshot.fx_rates[currency.toUpperCase()]
    if (rate === undefined || amount <= 0) return
    sums.set(key, (sums.get(key) ?? 0) + amount * rate)
  }
  for (const p of snapshot.positions.filter(isValued)) {
    const key = by === 'holding' ? p.symbol
      : by === 'account' ? accountLabel(p.account_id)
      : by === 'class' ? ASSET_CLASS_LABEL[p.asset_class]
      : p.currency
    add(key, p.market_value, p.currency)
  }
  for (const a of snapshot.accounts) {
    for (const c of a.cash) {
      add(by === 'account' ? accountLabel(a.account_id) : by === 'currency' ? c.currency : CASH_LABEL, c.amount, c.currency)
    }
  }
  return [...sums].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

/** Sorted by unrealized P&L, biggest loss first so the bars read left to right as a ranking. */
export function gainLossRanking(positions: PricedPosition[]): PricedPosition[] {
  return [...positions].sort((a, b) => a.unrealized_pnl - b.unrealized_pnl)
}

export const positionKey = (p: Pick<Position, 'account_id' | 'symbol'>) => `${p.account_id}:${p.symbol}`

/**
 * Chart labels for positions: the symbol alone, unless it is held in several accounts; then the
 * account type is added (XEQT.TO · TFSA), or institution and type if the type alone still collides.
 */
export function holdingLabels(
  rows: Pick<Position, 'account_id' | 'symbol'>[],
  account: (id: number) => { institution: string; account_type: string } | undefined,
): string[] {
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())
  const bySymbol = count(rows.map((r) => r.symbol))
  const typed = rows.map((r) => `${r.symbol} · ${account(r.account_id)?.account_type ?? `#${r.account_id}`}`)
  const byTyped = count(typed)
  return rows.map((r, i) => {
    if (bySymbol.get(r.symbol) === 1) return r.symbol
    if (byTyped.get(typed[i]) === 1) return typed[i]
    const a = account(r.account_id)
    return a ? `${r.symbol} · ${a.institution} ${a.account_type}` : typed[i]
  })
}
