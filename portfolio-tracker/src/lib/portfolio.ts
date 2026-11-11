import type { PortfolioSnapshot, Position } from '../types'
import { isValued } from './aggregate'

const CA_SUFFIX = /\.(TO|V|VN|CN|NE)$/i

/** Tickers as the design shows them: Canadian listings without their exchange suffix (RY.TO -> RY). */
export const displaySymbol = (symbol: string) => symbol.replace(CA_SUFFIX, '')

/** Base-currency value of a position at the snapshot's spot rate; null without a price or a rate. */
export function valueBase(snapshot: PortfolioSnapshot, p: Position): number | null {
  const rate = snapshot.fx_rates[p.currency.toUpperCase()]
  return isValued(p) && rate !== undefined ? p.market_value * rate : null
}

export interface DayChange {
  /** In the base currency. */
  amount: number
  /** Against yesterday's value of the same total; null when there is nothing to compare. */
  pct: number | null
}

/**
 * Today's move of `positions` in the base currency, from each quote's change against the previous
 * close: value x pct / (100 + pct). Cash doesn't move, but counts in the total the percentage is of.
 */
export function dayChange(snapshot: PortfolioSnapshot, positions: Position[], total: number | null): DayChange {
  let amount = 0
  for (const p of positions) {
    const v = valueBase(snapshot, p)
    if (v === null || p.day_change_pct === null) continue
    amount += (v * p.day_change_pct) / (100 + p.day_change_pct)
  }
  const before = total === null ? null : total - amount
  return { amount, pct: before ? (amount / before) * 100 : null }
}

export const portfolioDayChange = (snapshot: PortfolioSnapshot) =>
  dayChange(snapshot, snapshot.positions, snapshot.total_assets_base)

export function accountDayChange(snapshot: PortfolioSnapshot, accountId: number): DayChange {
  const total = snapshot.accounts.find((a) => a.account_id === accountId)?.total ?? null
  return dayChange(snapshot, snapshot.positions.filter((p) => p.account_id === accountId), total)
}

/** Registered (tax-sheltered) Canadian account types, as brokers name them. */
const SHELTERED = /\b(TFSA|RRSP|FHSA|RESP|RRIF|LIRA|LIF|RDSP|PRPP|SPOUSAL)\b/i
export const isSheltered = (accountType: string | undefined) => !!accountType && SHELTERED.test(accountType)

export interface Exposure {
  sheltered: number
  taxable: number
  /** USD holdings and cash, converted. */
  usd: number
  total: number
}

/** How much sits in registered vs taxable accounts, and in US dollars (base currency, spot). */
export function exposure(snapshot: PortfolioSnapshot, accountType: (accountId: number) => string | undefined): Exposure {
  let sheltered = 0
  let taxable = 0
  for (const a of snapshot.accounts) {
    if (isSheltered(accountType(a.account_id))) sheltered += a.total
    else taxable += a.total
  }
  let usd = 0
  const rate = snapshot.fx_rates.USD
  if (rate !== undefined) {
    for (const p of snapshot.positions) if (p.currency.toUpperCase() === 'USD') usd += valueBase(snapshot, p) ?? 0
    for (const a of snapshot.accounts) {
      for (const c of a.cash) if (c.currency.toUpperCase() === 'USD' && c.amount > 0) usd += c.amount * rate
    }
  }
  return { sheltered, taxable, usd, total: sheltered + taxable }
}

/** Colours for allocation slices, in order (design tokens k1..k6). */
export const SERIES_VARS = ['var(--k1)', 'var(--k2)', 'var(--k3)', 'var(--k4)', 'var(--k5)', 'var(--k6)']

/** Market map tile colours (design: −3% .. +3% scale) and the text colour that reads on each. */
export function heatColor(pct: number | null): { bg: string; fg: string } {
  const c = pct ?? 0
  if (c >= 2) return { bg: 'var(--h3)', fg: '#FFFFFF' }
  if (c >= 0.75) return { bg: 'var(--h2)', fg: 'var(--ink)' }
  if (c > 0.1) return { bg: 'var(--h1)', fg: 'var(--ink)' }
  if (c >= -0.1) return { bg: 'var(--h0)', fg: 'var(--ink)' }
  if (c > -0.75) return { bg: 'var(--n1)', fg: 'var(--ink)' }
  if (c > -2) return { bg: 'var(--n2)', fg: 'var(--ink)' }
  return { bg: 'var(--n3)', fg: '#FFFFFF' }
}
