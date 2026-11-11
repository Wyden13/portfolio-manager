import { describe, expect, it } from 'vitest'
import type { PortfolioSnapshot, Position } from '../types'
import { allocation, costNote, currenciesOf, gainLossRanking, holdingLabels, pricedIn, valuedIn } from './aggregate'

function position(account_id: number, symbol: string, currency: string, cost: number, value: number): Position {
  return {
    account_id, symbol, currency, quantity: 1, average_cost: cost, cost_basis: cost, price: value,
    market_value: value, unrealized_pnl: value - cost, unrealized_pct: ((value - cost) / cost) * 100,
    status: 'ok', first_buy_at: null, incomplete_history: false, source: 'transactions', asset_class: 'stock',
    day_change_pct: null, volume: null,
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
    fx_rates: { CAD: 1, USD: 1.5 },
    accounts: [],
    base_currency: 'CAD',
    cash_base: null,
    total_assets_base: null,
  }

  it('lists currencies and never mixes them', () => {
    expect(currenciesOf(snap)).toEqual(['CAD', 'USD'])
    expect(pricedIn(snap, 'CAD').every((p) => p.currency === 'CAD')).toBe(true)
  })

  it('skips positions without a usable quote', () => {
    const broken = { ...snap, positions: snap.positions.map((p, i) => (i === 0 ? { ...p, status: 'no_quote' as const, market_value: null } : p)) }
    expect(pricedIn(broken, 'USD').some((p) => p.symbol === snap.positions[0].symbol)).toBe(false)
  })

  it('groups allocation by account in the base currency and sums to the converted total', () => {
    const slices = allocation(snap, 'account', (id) => `Account ${id}`)
    expect(slices.map((s) => s.name)).toEqual(['Account 1', 'Account 3', 'Account 2']) // 330 x 1.5, 120 CAD, 60 x 1.5
    expect(slices[0].value).toBeCloseTo((150 + 180) * 1.5, 6)
    expect(slices.reduce((a, s) => a + s.value, 0)).toBeCloseTo((150 + 180 + 60) * 1.5 + 120, 6)
  })

  it('counts cash as its own class, under its currency, or in its account', () => {
    const cash = (account_id: number, currency: string, amount: number) => ({
      account_id, market_value: 0, cost_basis: 0, unrealized_pnl: 0, unrealized_pct: null, cash_value: 0, total: 0,
      holdings: 0, complete: true, cash: [{ currency, amount, estimated: false }],
    })
    const withCash: PortfolioSnapshot = {
      ...snap,
      positions: [...snap.positions, { ...position(3, 'XEQT.TO', 'CAD', 10, 30), asset_class: 'etf' }, position(3, 'GBX', 'GBP', 1, 99)],
      accounts: [cash(3, 'CAD', 50), cash(1, 'USD', 10), cash(2, 'USD', -40)],
    }
    const label = (id: number) => `Account ${id}`
    expect(allocation(withCash, 'class', label)).toEqual([
      { name: 'Stocks', value: (150 + 180 + 60) * 1.5 + 120 }, { name: 'Cash', value: 65 }, { name: 'ETFs', value: 30 },
    ]) // GBP has no rate and the margin debit can't be a slice
    expect(allocation(withCash, 'currency', label)).toEqual([{ name: 'USD', value: 600 }, { name: 'CAD', value: 200 }])
    expect(allocation(withCash, 'account', label).find((s) => s.name === 'Account 3')?.value).toBe(200)
    expect(allocation(withCash, 'holding', label).find((s) => s.name === 'Cash')?.value).toBe(65)
  })

  it('ranks gain/loss ascending', () => {
    const ranked = gainLossRanking(pricedIn(snap, 'USD')).map((p) => p.unrealized_pnl)
    expect(ranked).toEqual([...ranked].sort((a, b) => a - b))
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
