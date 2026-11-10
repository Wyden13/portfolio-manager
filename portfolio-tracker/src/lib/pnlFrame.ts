import { fromBinary } from '@bufbuild/protobuf'
import { PnLUpdateSchema, Source, Status, type CurrencyTotal as ProtoTotal } from '../gen/pnl_pb'
import type { CurrencyTotal, PortfolioSnapshot, PositionStatus } from '../types'

const STATUS: Record<number, PositionStatus> = {
  [Status.OK]: 'ok',
  [Status.NO_QUOTE]: 'no_quote',
  [Status.CURRENCY_MISMATCH]: 'currency_mismatch',
  [Status.NO_COST]: 'no_cost',
}

const total = (t: ProtoTotal): CurrencyTotal => ({
  currency: t.currency,
  cost_basis: t.costBasis,
  market_value: t.marketValue,
  unrealized_pnl: t.unrealizedPnl,
  unrealized_pct: t.unrealizedPct,
})

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
      // proto3 sends 0.0 for "absent": P&L only means something when OK, price and value also
      // when NO_COST, cost only when not NO_COST.
      const ok = p.status === Status.OK
      const priced = ok || p.status === Status.NO_COST
      const costed = p.status !== Status.NO_COST
      return {
        account_id: Number(p.accountId),
        symbol: p.symbol,
        currency: p.currency,
        quantity: p.quantity,
        average_cost: costed ? p.averageCost : null,
        cost_basis: costed ? p.costBasis : null,
        price: priced ? p.price : null,
        market_value: priced ? p.marketValue : null,
        unrealized_pnl: ok ? p.unrealizedPnl : null,
        unrealized_pct: ok ? p.unrealizedPct : null,
        status: STATUS[p.status] ?? 'no_quote',
        first_buy_at: p.firstBuyMs ? new Date(Number(p.firstBuyMs)).toISOString() : null,
        incomplete_history: p.incompleteHistory,
        source: p.source === Source.BROKER ? 'broker' : 'transactions',
      }
    }),
    totals: msg.totals.map(total),
    base_total: msg.baseTotal ? total(msg.baseTotal) : null,
    fx_rates: { ...msg.fxRates },
  }
}
