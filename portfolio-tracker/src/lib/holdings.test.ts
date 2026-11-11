import { describe, expect, it } from 'vitest'
import type { PortfolioSnapshot, Position, SecurityProfile } from '../types'
import {
  faviconUrl, filterRows, holdingRows, NO_FILTERS, paginate, sortRows, tickerMonogram, toCsv,
} from './holdings'

function position(account_id: number, symbol: string, currency: string, qty: number, cost: number | null, price: number): Position {
  const value = qty * price
  return {
    account_id, symbol, currency, quantity: qty, average_cost: cost === null ? null : cost / qty, cost_basis: cost,
    price, market_value: value, unrealized_pnl: cost === null ? null : value - cost,
    unrealized_pct: cost === null ? null : ((value - cost) / cost) * 100, status: cost === null ? 'no_cost' : 'ok',
    first_buy_at: null, incomplete_history: false, source: 'transactions', asset_class: 'stock',
    day_change_pct: 1.5, volume: 1000,
  }
}

const profile = (name: string, sector: string | null, market_cap: number | null, currency = 'USD'): SecurityProfile => ({
  asset_class: 'stock', name, sector, industry: null, country: null, market_cap, market_cap_currency: currency,
  pe: null, website: null,
})

const snapshot: PortfolioSnapshot = {
  as_of: '2026-01-01T00:00:00Z',
  positions: [
    position(1, 'AAPL', 'USD', 10, 1000, 150), position(2, 'AAPL', 'USD', 5, 600, 150),
    position(1, 'RY.TO', 'CAD', 20, 2000, 110), position(2, 'TD.TO', 'CAD', 4, null, 80),
    { ...position(2, 'XYZ', 'USD', 1, 10, 0), status: 'no_quote', price: null, market_value: null, unrealized_pnl: null },
  ],
  totals: [], base_total: null, fx_rates: { CAD: 1, USD: 1.5 }, accounts: [], base_currency: 'CAD',
  cash_base: 0, total_assets_base: 10000,
}
const profiles = { AAPL: profile('Apple Inc.', 'Technology', 3e12), 'RY.TO': profile('Royal Bank of Canada', 'Financial Services', 2.5e11, 'CAD') }

describe('holdings', () => {
  const rows = holdingRows(snapshot, profiles)
  const bySymbol = Object.fromEntries(rows.map((r) => [r.symbol, r]))

  it('adds a listing up across accounts, with a line per account', () => {
    const aapl = bySymbol.AAPL
    expect(aapl).toMatchObject({ quantity: 15, costBasis: 1600, marketValue: 2250, pnl: 650, accountIds: [1, 2] })
    expect(aapl.averageCost).toBeCloseTo(1600 / 15)
    expect(aapl.pnlPct).toBeCloseTo(40.625)
    expect([aapl.valueBase, aapl.pnlBase, aapl.weight]).toEqual([3375, 975, 33.75])
    expect(aapl.children.map((c) => [c.accountIds, c.marketValue])).toEqual([[[1], 1500], [[2], 750]])
    expect(aapl.profile?.name).toBe('Apple Inc.')
  })

  it('keeps value but not cost or P&L when the broker gave no cost, and nothing without a price', () => {
    expect(bySymbol['TD.TO']).toMatchObject({ marketValue: 320, valueBase: 320, costBasis: null, averageCost: null, pnl: null, pnlPct: null })
    expect(bySymbol.XYZ).toMatchObject({ marketValue: null, valueBase: null, weight: null, profile: null })
  })

  it('counts only one account when asked', () => {
    expect(holdingRows(snapshot, profiles, 1).map((r) => [r.symbol, r.quantity])).toEqual([['AAPL', 10], ['RY.TO', 20]])
  })

  it('sorts money in the base currency and puts missing values last both ways', () => {
    const rates = snapshot.fx_rates
    expect(sortRows(rows, 'marketValue', 'desc', rates).map((r) => r.symbol)).toEqual(['AAPL', 'RY.TO', 'TD.TO', 'XYZ'])
    expect(sortRows(rows, 'marketValue', 'asc', rates).map((r) => r.symbol)).toEqual(['TD.TO', 'RY.TO', 'AAPL', 'XYZ'])
    expect(sortRows(rows, 'name', 'asc', rates).map((r) => r.symbol)).toEqual(['AAPL', 'RY.TO', 'TD.TO', 'XYZ'])
    // 3T USD x 1.5 beats 250B CAD.
    expect(sortRows(rows, 'marketCap', 'desc', rates).map((r) => r.symbol).slice(0, 2)).toEqual(['AAPL', 'RY.TO'])
  })

  it('filters by text on ticker or company, sector, class and currency', () => {
    const f = (patch: Partial<typeof NO_FILTERS>) => filterRows(rows, { ...NO_FILTERS, ...patch }).map((r) => r.symbol)
    expect(f({ query: 'royal' })).toEqual(['RY.TO'])
    expect(f({ query: 'td' })).toEqual(['TD.TO'])
    expect(f({ sector: 'Technology' })).toEqual(['AAPL'])
    expect(f({ currency: 'CAD' })).toEqual(['RY.TO', 'TD.TO'])
    expect(f({ assetClass: 'etf' })).toEqual([])
  })

  it('pages, clamping past the end, and shows everything with all', () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    expect(paginate(items, 10, 0)).toEqual({ rows: items.slice(0, 10), page: 0, pages: 3 })
    expect(paginate(items, 10, 9)).toEqual({ rows: items.slice(20), page: 2, pages: 3 })
    expect(paginate(items, 'all', 4)).toEqual({ rows: items, page: 0, pages: 1 })
    expect(paginate([], 20, 0)).toEqual({ rows: [], page: 0, pages: 1 })
  })

  it('builds favicons from websites and monograms from tickers', () => {
    expect(faviconUrl('https://www.rbc.com/en')).toBe('https://www.google.com/s2/favicons?domain=www.rbc.com&sz=64')
    expect(faviconUrl('abc.xyz')).toBe('https://www.google.com/s2/favicons?domain=abc.xyz&sz=64')
    expect(faviconUrl(null)).toBeNull()
    expect(faviconUrl('not a url')).toBeNull()
    expect([tickerMonogram('RY.TO'), tickerMonogram('BRK.B'), tickerMonogram('GOOGL')]).toEqual(['RY', 'BRK', 'GOO'])
  })

  it('exports CSV with native and base amounts, quoting where needed', () => {
    const csv = toCsv([bySymbol.AAPL], 'CAD', (id) => `Acct, ${id}`).trim().split('\n')
    expect(csv[0]).toContain('Market value (CAD)')
    expect(csv[1]).toBe('AAPL,Apple Inc.,Technology,,,stock,3000000000000,USD,,USD,150,1.5,1000,15,106.6667,2250,650,40.63,3375,975,33.75,"Acct, 1; Acct, 2"')
  })
})
