import type { AssetClass, PortfolioSnapshot, Position, SecurityProfile } from '../types'
import { isValued } from './aggregate'

/** One account's position, or several accounts' positions in one listing added up. */
export interface HoldingLine {
  key: string
  symbol: string
  currency: string
  accountIds: number[]
  quantity: number
  /** Null when some lot has no cost basis (the broker didn't report one). */
  averageCost: number | null
  costBasis: number | null
  price: number | null
  marketValue: number | null
  pnl: number | null
  pnlPct: number | null
  /** marketValue and pnl in the base currency at spot; null without a price or a rate. */
  valueBase: number | null
  pnlBase: number | null
  /** Share of total assets (holdings plus cash), in percent. */
  weight: number | null
  dayChangePct: number | null
  volume: number | null
  assetClass: AssetClass
}

export interface HoldingRow extends HoldingLine {
  profile: SecurityProfile | null
  /** One line per account; the row itself is their sum. */
  children: HoldingLine[]
}

export type Profiles = Record<string, SecurityProfile>

const sum = (values: Array<number | null>): number | null =>
  values.some((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v as number), 0)

function lineOf(key: string, positions: Position[], snapshot: PortfolioSnapshot): HoldingLine {
  const [first] = positions
  const rate = snapshot.fx_rates[first.currency.toUpperCase()] ?? null
  const valued = positions.every(isValued)
  const quantity = positions.reduce((a, p) => a + (p.quantity ?? 0), 0)
  const costBasis = sum(positions.map((p) => p.cost_basis))
  const marketValue = valued ? sum(positions.map((p) => p.market_value)) : null
  const pnl = sum(positions.map((p) => p.unrealized_pnl))
  const valueBase = marketValue !== null && rate !== null ? marketValue * rate : null
  const total = snapshot.total_assets_base
  return {
    key,
    symbol: first.symbol,
    currency: first.currency,
    accountIds: [...new Set(positions.map((p) => p.account_id))],
    quantity,
    averageCost: costBasis !== null && quantity ? costBasis / quantity : null,
    costBasis,
    price: first.price,
    marketValue,
    pnl,
    pnlPct: pnl !== null && costBasis ? (pnl / costBasis) * 100 : null,
    valueBase,
    pnlBase: pnl !== null && rate !== null ? pnl * rate : null,
    weight: valueBase !== null && total ? (valueBase / total) * 100 : null,
    dayChangePct: first.day_change_pct,
    volume: first.volume,
    assetClass: first.asset_class,
  }
}

/**
 * One row per listing (symbol and currency), summed across accounts, with a child line per account.
 * With `accountId`, only that account's positions are counted.
 */
export function holdingRows(snapshot: PortfolioSnapshot, profiles: Profiles, accountId?: number): HoldingRow[] {
  const groups = new Map<string, Position[]>()
  for (const p of snapshot.positions) {
    if (accountId !== undefined && p.account_id !== accountId) continue
    const key = `${p.symbol}|${p.currency}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups].map(([key, positions]) => ({
    ...lineOf(key, positions, snapshot),
    profile: profiles[positions[0].symbol] ?? null,
    children: positions
      .map((p) => lineOf(`${key}|${p.account_id}`, [p], snapshot))
      .sort((a, b) => (b.valueBase ?? -Infinity) - (a.valueBase ?? -Infinity)),
  }))
}

export type SortKey =
  | 'symbol' | 'name' | 'sector' | 'industry' | 'country' | 'marketCap' | 'pe' | 'price' | 'dayChange' | 'volume'
  | 'quantity' | 'averageCost' | 'marketValue' | 'pnl' | 'pnlPct' | 'weight'
export type SortDir = 'asc' | 'desc'

/** Text columns sort A to Z first; numbers biggest first. */
export const defaultDir = (key: SortKey): SortDir =>
  ['symbol', 'name', 'sector', 'industry', 'country'].includes(key) ? 'asc' : 'desc'

function sortValue(row: HoldingRow, key: SortKey, rates: Record<string, number>): string | number | null {
  const p = row.profile
  switch (key) {
    case 'symbol': return row.symbol
    case 'name': return p?.name ?? null
    case 'sector': return p?.sector ?? null
    case 'industry': return p?.industry ?? null
    case 'country': return p?.country ?? null
    case 'marketCap': {
      // Compare caps in one currency when the rate is known.
      const rate = p?.market_cap_currency ? rates[p.market_cap_currency.toUpperCase()] : undefined
      return p?.market_cap == null ? null : p.market_cap * (rate ?? 1)
    }
    case 'pe': return p?.pe ?? null
    case 'price': return row.price
    case 'dayChange': return row.dayChangePct
    case 'volume': return row.volume
    case 'quantity': return row.quantity
    case 'averageCost': return row.averageCost
    // Money sorts in the base currency so CAD and USD rows compare fairly.
    case 'marketValue': return row.valueBase
    case 'pnl': return row.pnlBase
    case 'pnlPct': return row.pnlPct
    case 'weight': return row.weight
  }
}

/** Sorted copy; rows without a value go last whichever the direction. */
export function sortRows(rows: HoldingRow[], key: SortKey, dir: SortDir, rates: Record<string, number>): HoldingRow[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key, rates)
    const y = sortValue(b, key, rates)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)
    return order * sign || a.symbol.localeCompare(b.symbol)
  })
}

export interface HoldingFilters {
  query: string
  sector: string
  assetClass: AssetClass | ''
  currency: string
}

export const NO_FILTERS: HoldingFilters = { query: '', sector: '', assetClass: '', currency: '' }

export function filterRows(rows: HoldingRow[], f: HoldingFilters): HoldingRow[] {
  const q = f.query.trim().toLowerCase()
  return rows.filter((r) =>
    (!q || r.symbol.toLowerCase().includes(q) || (r.profile?.name ?? '').toLowerCase().includes(q)) &&
    (!f.sector || r.profile?.sector === f.sector) &&
    (!f.assetClass || r.assetClass === f.assetClass) &&
    (!f.currency || r.currency === f.currency))
}

export type PageSize = 10 | 20 | 50 | 'all'
export const PAGE_SIZES: readonly PageSize[] = [10, 20, 50, 'all']

/** The rows on `page` (0-based, clamped to the last page) and how many pages there are. */
export function paginate<T>(rows: T[], size: PageSize, page: number): { rows: T[]; page: number; pages: number } {
  if (size === 'all') return { rows, page: 0, pages: 1 }
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(page, 0), pages - 1)
  return { rows: rows.slice(p * size, (p + 1) * size), page: p, pages }
}

/** Google's favicon service for the company's website; null without a usable website. */
export function faviconUrl(website: string | null | undefined): string | null {
  if (!website) return null
  try {
    const host = new URL(website.includes('://') ? website : `https://${website}`).hostname
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null
  } catch {
    return null
  }
}

/** Up to three letters of a ticker without its exchange suffix (RY.TO -> RY, BRK.B -> BRK). */
export const tickerMonogram = (symbol: string) => symbol.split('.')[0].slice(0, 3).toUpperCase()

const csvCell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The rows as CSV: native amounts with their currency, plus value and P&L in the base currency. */
export function toCsv(rows: HoldingRow[], base: string, accountLabel: (id: number) => string): string {
  const header = [
    'Ticker', 'Company', 'Sector', 'Industry', 'Country', 'Asset class', 'Market cap', 'Market cap currency', 'P/E',
    'Currency', 'Price', 'Change %', 'Volume', 'Quantity', 'Avg cost', 'Market value', 'Unrealized P&L',
    'Unrealized P&L %', `Market value (${base})`, `Unrealized P&L (${base})`, 'Weight %', 'Accounts',
  ]
  const round = (v: number | null, digits: number) => (v === null ? null : Number(v.toFixed(digits)))
  const lines = rows.map((r) => [
    r.symbol, r.profile?.name, r.profile?.sector, r.profile?.industry, r.profile?.country, r.assetClass,
    r.profile?.market_cap, r.profile?.market_cap_currency, round(r.profile?.pe ?? null, 2),
    r.currency, r.price, round(r.dayChangePct, 2), r.volume, r.quantity, round(r.averageCost, 4),
    round(r.marketValue, 2), round(r.pnl, 2), round(r.pnlPct, 2), round(r.valueBase, 2), round(r.pnlBase, 2),
    round(r.weight, 2), r.accountIds.map(accountLabel).join('; '),
  ].map(csvCell).join(','))
  return [header.map(csvCell).join(','), ...lines].join('\n') + '\n'
}
