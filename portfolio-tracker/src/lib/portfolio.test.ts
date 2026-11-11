import { describe, expect, it } from 'vitest'
import type { AccountSummary, PortfolioSnapshot, Position } from '../types'
import { accountDayChange, displaySymbol, exposure, heatColor, isSheltered, portfolioDayChange } from './portfolio'

const pos = (over: Partial<Position>): Position => ({
  account_id: 1, symbol: 'X', currency: 'CAD', quantity: 1, average_cost: 1, cost_basis: 1, price: 1, market_value: 0,
  unrealized_pnl: 0, unrealized_pct: 0, status: 'ok', first_buy_at: null, incomplete_history: false, source: 'transactions',
  asset_class: 'stock', day_change_pct: null, volume: null, ...over,
})

const account = (over: Partial<AccountSummary>): AccountSummary => ({
  account_id: 1, market_value: 0, cost_basis: 0, unrealized_pnl: 0, unrealized_pct: null, cash: [], cash_value: 0,
  total: 0, holdings: 0, complete: true, ...over,
})

const snapshot: PortfolioSnapshot = {
  as_of: '2026-11-11T16:48:00Z',
  positions: [
    pos({ account_id: 1, symbol: 'RY.TO', market_value: 1100, day_change_pct: 10 }),
    pos({ account_id: 2, symbol: 'NVDA', currency: 'USD', market_value: 100, day_change_pct: -50 }),
    pos({ account_id: 2, symbol: 'NOQ', status: 'no_quote', market_value: null, day_change_pct: 5 }),
  ],
  totals: [],
  base_total: null,
  fx_rates: { CAD: 1, USD: 1.5 },
  accounts: [
    account({ account_id: 1, total: 1200 }),
    account({ account_id: 2, total: 250, cash: [{ currency: 'USD', amount: 10, estimated: false }] }),
  ],
  base_currency: 'CAD',
  cash_base: 0,
  total_assets_base: 1450,
}

describe('portfolio maths', () => {
  it('strips Canadian exchange suffixes only', () => {
    expect(displaySymbol('RY.TO')).toBe('RY')
    expect(displaySymbol('BBD.B.TO')).toBe('BBD.B')
    expect(displaySymbol('BRK.B')).toBe('BRK.B')
  })

  it('derives the day change from each quote', () => {
    // RY: 1100 now, +10% -> +100. NVDA: 150 CAD now, -50% -> -150. Unpriced rows are skipped.
    const d = portfolioDayChange(snapshot)
    expect(d.amount).toBeCloseTo(-50)
    expect(d.pct).toBeCloseTo((-50 / 1500) * 100)
    expect(accountDayChange(snapshot, 1).amount).toBeCloseTo(100)
    // The account also holds 100 of cash: 100 on 1,100 at yesterday's close.
    expect(accountDayChange(snapshot, 1).pct).toBeCloseTo((100 / 1100) * 100)
  })

  it('splits registered and taxable accounts, and finds USD exposure', () => {
    expect(isSheltered('TFSA')).toBe(true)
    expect(isSheltered('Margin')).toBe(false)
    const e = exposure(snapshot, (id) => (id === 1 ? 'RRSP' : 'Cash'))
    expect(e.sheltered).toBe(1200)
    expect(e.taxable).toBe(250)
    expect(e.usd).toBeCloseTo(150 + 15)
  })

  it('colours the map on a fixed scale', () => {
    expect(heatColor(3).bg).toBe('var(--h3)')
    expect(heatColor(0).bg).toBe('var(--h0)')
    expect(heatColor(-2.5).bg).toBe('var(--n3)')
    expect(heatColor(null).bg).toBe('var(--h0)')
  })
})
