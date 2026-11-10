import { fromBinary } from '@bufbuild/protobuf'
import { PnLUpdateSchema, Status } from '../gen/pnl_pb'
import type { PortfolioSnapshot, PositionStatus } from '../types'

const STATUS: Record<number, PositionStatus> = {
  [Status.OK]: 'ok',
  [Status.NO_QUOTE]: 'no_quote',
  [Status.CURRENCY_MISMATCH]: 'currency_mismatch',
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Decode one SSE `data:` payload (base64 protobuf PnLUpdate) into the REST snapshot shape. */
export function decodePnLFrame(b64: string): PortfolioSnapshot {
  const msg = fromBinary(PnLUpdateSchema, base64ToBytes(b64.trim()))
  return {
    as_of: new Date(Number(msg.asOfMs)).toISOString(),
    positions: msg.positions.map((p) => {
      const ok = p.status === Status.OK
      return {
        account_id: Number(p.accountId),
        symbol: p.symbol,
        currency: p.currency,
        quantity: p.quantity,
        average_cost: p.averageCost,
        cost_basis: p.costBasis,
        // proto3 sends 0.0 for "absent"; the values are only meaningful when status is OK
        price: ok ? p.price : null,
        market_value: ok ? p.marketValue : null,
        unrealized_pnl: ok ? p.unrealizedPnl : null,
        unrealized_pct: ok ? p.unrealizedPct : null,
        status: STATUS[p.status] ?? 'no_quote',
        first_buy_at: p.firstBuyMs ? new Date(Number(p.firstBuyMs)).toISOString() : null,
        incomplete_history: p.incompleteHistory,
      }
    }),
    totals: msg.totals.map((t) => ({
      currency: t.currency,
      cost_basis: t.costBasis,
      market_value: t.marketValue,
      unrealized_pnl: t.unrealizedPnl,
      unrealized_pct: t.unrealizedPct,
    })),
  }
}
