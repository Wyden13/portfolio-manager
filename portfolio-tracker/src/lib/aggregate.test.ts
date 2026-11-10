import { describe, expect, it } from 'vitest'
import type { PortfolioSnapshot, Position } from '../types'
import { allocation, currenciesOf, gainLossRanking, pricedIn } from './aggregate'
import { tileColor } from './theme'

function position(account_id: number, symbol: string, currency: string, cost: number, value: number): Position {
  return {
    account_id, symbol, currency, quantity: 1, average_cost: cost, cost_basis: cost, price: value,
    market_value: value, unrealized_pnl: value - cost, unrealized_pct: ((value - cost) / cost) * 100,
    status: 'ok', first_buy_at: null, incomplete_history: false,
  }
}

describe('aggregate', () => {
  const snap: PortfolioSnapshot = {
    as_of: '2026-01-01T00:00:00Z',
    positions: [
      position(1, 'AAPL', 'USD', 100, 150), position(1, 'MSFT', 'USD', 200, 180), position(2, 'KO', 'USD', 50, 60),
      position(3, 'RY.TO', 'CAD', 100, 120),
    ],
    totals: [],
  }

  it('lists currencies and never mixes them', () => {
    expect(currenciesOf(snap)).toEqual(['CAD', 'USD'])
    expect(pricedIn(snap, 'CAD').every((p) => p.currency === 'CAD')).toBe(true)
  })

  it('skips positions without a usable quote', () => {
    const broken = { ...snap, positions: snap.positions.map((p, i) => (i === 0 ? { ...p, status: 'no_quote' as const, market_value: null } : p)) }
    expect(pricedIn(broken, 'USD').some((p) => p.symbol === snap.positions[0].symbol)).toBe(false)
  })

  it('groups allocation by account and sums to the currency total', () => {
    const rows = pricedIn(snap, 'USD')
    const slices = allocation(rows, 'account')
    expect(slices.map((s) => s.name)).toEqual(expect.arrayContaining(['Account 1', 'Account 2']))
    const total = rows.reduce((a, p) => a + p.market_value, 0)
    expect(slices.reduce((a, s) => a + s.value, 0)).toBeCloseTo(total, 6)
  })

  it('ranks gain/loss ascending', () => {
    const ranked = gainLossRanking(pricedIn(snap, 'USD')).map((p) => p.unrealized_pnl)
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b))
  })

  it('colours losses red-ish and gains green-ish', () => {
    const [lr, , lb] = tileColor(-10).match(/\d+/g)!.map(Number)
    const [gr, gg] = tileColor(10).match(/\d+/g)!.map(Number)
    expect(lr).toBeGreaterThan(lb)
    expect(gg).toBeGreaterThan(gr)
  })
})
