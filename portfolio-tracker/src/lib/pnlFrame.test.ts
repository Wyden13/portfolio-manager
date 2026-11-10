import { create, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { PnLUpdateSchema, Status } from '../gen/pnl_pb'
import { decodePnLFrame } from './pnlFrame'

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

describe('decodePnLFrame', () => {
  const frame = toBase64(toBinary(PnLUpdateSchema, create(PnLUpdateSchema, {
    asOfMs: 1_700_000_000_000n,
    positions: [
      {
        accountId: 7n, symbol: 'AAPL', currency: 'USD', quantity: 10, averageCost: 100, costBasis: 1000,
        price: 150, marketValue: 1500, unrealizedPnl: 500, unrealizedPct: 50, firstBuyMs: 1_690_000_000_000n,
        status: Status.OK,
      },
      { accountId: 7n, symbol: 'XYZ', currency: 'CAD', costBasis: 200, status: Status.NO_QUOTE, incompleteHistory: true },
    ],
    totals: [{ currency: 'USD', costBasis: 1000, marketValue: 1500, unrealizedPnl: 500, unrealizedPct: 50 }],
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

  it('keeps totals per currency', () => {
    expect(decodePnLFrame(frame).totals).toEqual([
      { currency: 'USD', cost_basis: 1000, market_value: 1500, unrealized_pnl: 500, unrealized_pct: 50 },
    ])
  })

  it('rejects garbage', () => {
    expect(() => decodePnLFrame('!!!not base64!!!')).toThrow()
  })
})
