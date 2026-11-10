import { describe, expect, it } from 'vitest'
import type { PortfolioSnapshot, Position } from '../types'
import { allocation, costNote, currenciesOf, gainLossRanking, holdingLabels, pricedIn, valuedIn } from './aggregate'
import { tileColor } from './theme'

function position(account_id: number, symbol: string, currency: string, cost: number, value: number): Position {
  return {
    account_id, symbol, currency, quantity: 1, average_cost: cost, cost_basis: cost, price: value,
    market_value: value, unrealized_pnl: value - cost, unrealized_pct: ((value - cost) / cost) * 100,
    status: 'ok', first_buy_at: null, incomplete_history: false, source: 'transactions',
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
    base_total: null,
    fx_rates: {},
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
    const slices = allocation(rows, 'account', (id) => `Account ${id}`)
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

  it('labels a symbol by account only when it is held in more than one', () => {
    const accounts: Record<number, { institution: string; account_type: string }> = {
      1: { institution: 'Questrade', account_type: 'TFSA' }, 2: { institution: 'Wealthsimple', account_type: 'RRSP' },
      3: { institution: 'Wealthsimple', account_type: 'TFSA' },
    }
    const rows = [
      { account_id: 1, symbol: 'XEQT.TO' }, { account_id: 2, symbol: 'XEQT.TO' }, { account_id: 1, symbol: 'RY.TO' },
      { account_id: 1, symbol: 'VFV.TO' }, { account_id: 3, symbol: 'VFV.TO' },
    ]
    expect(holdingLabels(rows, (id) => accounts[id])).toEqual([
      'XEQT.TO · TFSA', 'XEQT.TO · RRSP', 'RY.TO', 'VFV.TO · Questrade TFSA', 'VFV.TO · Wealthsimple TFSA',
    ])
  })

  it('counts holdings without a broker cost basis toward value but not gain or loss', () => {
    const uncosted: Position = {
      ...snap.positions[3], symbol: 'TD.TO', status: 'no_cost', cost_basis: null, average_cost: null,
      unrealized_pnl: null, unrealized_pct: null, source: 'broker',
    }
    const withIt = { ...snap, positions: [...snap.positions, uncosted] }
    expect(valuedIn(withIt, 'CAD').map((p) => p.symbol)).toEqual(['RY.TO', 'TD.TO'])
    expect(pricedIn(withIt, 'CAD').map((p) => p.symbol)).toEqual(['RY.TO'])
    expect(costNote(uncosted)).toBe('No cost basis reported by the broker')
    expect(costNote({ ...snap.positions[0], source: 'broker' })).toBe('Cost basis reported by the broker')
    expect(costNote(snap.positions[0])).toBe('')
  })
})
