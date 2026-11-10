import { create, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { PnLUpdateSchema, Source, Status } from '../gen/pnl_pb'
import { decodePnLFrame } from './pnlFrame'

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

describe('decodePnLFrame', () => {
  const frame = toBase64(toBinary(PnLUpdateSchema, create(PnLUpdateSchema, {
    asOfMs: 1_700_000_000_000n,
    positions: [
      {
        accountId: 7n, symbol: 'AAPL', currency: 'USD', quantity: 10, averageCost: 100, costBasis: 1000,
        price: 150, marketValue: 1500, unrealizedPnl: 500, unrealizedPct: 50, firstBuyMs: 1_690_000_000_000n,
        status: Status.OK, assetClass: 'stock',
      },
      { accountId: 7n, symbol: 'XYZ', currency: 'CAD', costBasis: 200, status: Status.NO_QUOTE, incompleteHistory: true },
      { accountId: 8n, symbol: 'TD.TO', currency: 'CAD', quantity: 40, price: 90, marketValue: 3600, status: Status.NO_COST, source: Source.BROKER },
    ],
    totals: [{ currency: 'USD', costBasis: 1000, marketValue: 1500, unrealizedPnl: 500, unrealizedPct: 50 }],
    baseTotal: { currency: 'CAD', costBasis: 1360, marketValue: 2040, unrealizedPnl: 680, unrealizedPct: 50 },
    fxRates: { USD: 1.36 },
    accounts: [{
      accountId: 7n, marketValue: 2040, costBasis: 1360, unrealizedPnl: 680, unrealizedPct: 50,
      cash: [{ currency: 'USD', amount: 25, estimated: true }], cashValue: 34, total: 2074, holdings: 2, complete: true,
    }, { accountId: 8n, total: 3600, holdings: 1 }],
    baseCurrency: 'CAD',
    totalAssetsBase: 5674,
  })))

  it('maps a priced position', () => {
    const snap = decodePnLFrame(frame)
    expect(snap.as_of).toBe('2023-11-14T22:13:20.000Z')
    expect(snap.positions[0]).toMatchObject({
      account_id: 7, symbol: 'AAPL', currency: 'USD', market_value: 1500, unrealized_pnl: 500, status: 'ok',
    })
    expect(snap.positions[0].first_buy_at).toBe('2023-07-22T04:26:40.000Z')
  })

  it('nulls price fields when the quote is unusable and maps flags', () => {
    const bad = decodePnLFrame(frame).positions[1]
    expect(bad).toMatchObject({
      status: 'no_quote', price: null, market_value: null, unrealized_pnl: null,
      first_buy_at: null, incomplete_history: true, cost_basis: 200,
    })
  })

  it('keeps price but not cost for a holding without a broker cost basis', () => {
    expect(decodePnLFrame(frame).positions[2]).toMatchObject({
      status: 'no_cost', source: 'broker', price: 90, market_value: 3600, cost_basis: null, average_cost: null, unrealized_pnl: null,
    })
    expect(decodePnLFrame(frame).positions[0].source).toBe('transactions')
  })

  it('maps the base-currency total and FX rates', () => {
    const snap = decodePnLFrame(frame)
    expect(snap.base_total).toEqual({ currency: 'CAD', cost_basis: 1360, market_value: 2040, unrealized_pnl: 680, unrealized_pct: 50 })
    expect(snap.fx_rates).toEqual({ USD: 1.36 })
  })

  it('keeps totals per currency', () => {
    expect(decodePnLFrame(frame).totals).toEqual([
      { currency: 'USD', cost_basis: 1000, market_value: 1500, unrealized_pnl: 500, unrealized_pct: 50 },
    ])
  })

  it('rejects garbage', () => {
    expect(() => decodePnLFrame('!!!not base64!!!')).toThrow()
  })

  it('maps account summaries, cash and the base totals, keeping unset optionals null', () => {
    const snap = decodePnLFrame(frame)
    expect(snap.accounts[0]).toEqual({
      account_id: 7, market_value: 2040, cost_basis: 1360, unrealized_pnl: 680, unrealized_pct: 50,
      cash: [{ currency: 'USD', amount: 25, estimated: true }], cash_value: 34, total: 2074, holdings: 2, complete: true,
    })
    expect(snap.accounts[1]).toMatchObject({ account_id: 8, unrealized_pct: null, cash: [], complete: false })
    expect([snap.base_currency, snap.cash_base, snap.total_assets_base]).toEqual(['CAD', null, 5674])
    expect(snap.positions.map((p) => p.asset_class)).toEqual(['stock', 'other', 'other'])
  })
})
