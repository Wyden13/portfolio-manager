import { describe, expect, it } from 'vitest'
import { mockSnapshot } from '../api/mock'
import { allocation, currenciesOf, gainLossRanking, pricedIn } from './aggregate'
import { tileColor } from './theme'

describe('aggregate', () => {
  const snap = mockSnapshot()

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
