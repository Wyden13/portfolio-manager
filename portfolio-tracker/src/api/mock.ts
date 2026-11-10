import type {
  Candle, HistoryInterval, HistoryRange, HistoryResponse, PortfolioSnapshot, Position, ValueHistoryResponse,
} from '../types'

/** Deterministic PRNG so mock charts don't reshuffle on every render. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

const RANGE_DAYS: Record<HistoryRange, number> = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 }
const DAY = 86400

/** Fixed "now" (start of UTC day) keeps the mock series stable across renders. */
const midnightUtc = () => Math.floor(Date.now() / 1000 / DAY) * DAY

export function mockHistory(symbol: string, range: HistoryRange, interval: HistoryInterval): HistoryResponse {
  const rand = mulberry32(hash(symbol))
  const step = interval === '1wk' ? 7 : 1
  const days = RANGE_DAYS[range]
  const end = midnightUtc()
  const candles: Candle[] = []
  let price = 40 + rand() * 160
  for (let d = days; d >= 0; d -= step) {
    const time = end - d * DAY
    const day = new Date(time * 1000).getUTCDay()
    if (interval === '1d' && (day === 0 || day === 6)) continue
    const open = price
    const close = Math.max(1, open * (1 + (rand() - 0.48) * 0.04 * Math.sqrt(step)))
    const high = Math.max(open, close) * (1 + rand() * 0.012)
    const low = Math.min(open, close) * (1 - rand() * 0.012)
    candles.push({
      time,
      open: round(open), high: round(high), low: round(low), close: round(close),
      volume: Math.round((0.5 + rand()) * 2_000_000 * step),
    })
    price = close
  }
  return { symbol, currency: symbol.endsWith('.TO') ? 'CAD' : 'USD', range, interval, candles }
}

export function mockValueHistory(currency: string, range: HistoryRange, endValue: number): ValueHistoryResponse {
  const rand = mulberry32(hash(currency + range))
  const days = RANGE_DAYS[range]
  const end = midnightUtc()
  const drift: number[] = []
  let v = 1
  for (let d = 0; d <= days; d++) {
    v *= 1 + (rand() - 0.47) * 0.012
    drift.push(v)
  }
  const scale = endValue / drift[drift.length - 1]
  return {
    currency, range,
    points: drift.map((x, i) => ({ time: end - (days - i) * DAY, value: round(x * scale) })),
  }
}

const round = (n: number) => Math.round(n * 100) / 100

interface Seed { account_id: number; symbol: string; currency: string; qty: number; cost: number; price: number }

const SEEDS: Seed[] = [
  { account_id: 1, symbol: 'AAPL', currency: 'USD', qty: 40, cost: 165, price: 228 },
  { account_id: 1, symbol: 'MSFT', currency: 'USD', qty: 25, cost: 340, price: 412 },
  { account_id: 1, symbol: 'NVDA', currency: 'USD', qty: 60, cost: 95, price: 141 },
  { account_id: 1, symbol: 'TSLA', currency: 'USD', qty: 15, cost: 270, price: 231 },
  { account_id: 2, symbol: 'AMZN', currency: 'USD', qty: 30, cost: 150, price: 187 },
  { account_id: 2, symbol: 'META', currency: 'USD', qty: 12, cost: 520, price: 498 },
  { account_id: 2, symbol: 'KO', currency: 'USD', qty: 80, cost: 58, price: 63 },
  { account_id: 3, symbol: 'RY.TO', currency: 'CAD', qty: 90, cost: 128, price: 171 },
  { account_id: 3, symbol: 'SHOP.TO', currency: 'CAD', qty: 35, cost: 110, price: 148 },
  { account_id: 3, symbol: 'ENB.TO', currency: 'CAD', qty: 150, cost: 52, price: 49 },
  { account_id: 3, symbol: 'XIU.TO', currency: 'CAD', qty: 200, cost: 31, price: 38 },
  { account_id: 3, symbol: 'BCE.TO', currency: 'CAD', qty: 120, cost: 47, price: 34 },
]

/** Mock portfolio; `tick` nudges prices so the mock stream visibly moves. */
export function mockSnapshot(tick = 0): PortfolioSnapshot {
  const positions: Position[] = SEEDS.map((s) => {
    const rand = mulberry32(hash(s.symbol) + tick)
    const price = round(s.price * (1 + (rand() - 0.5) * 0.02))
    const cost_basis = round(s.qty * s.cost)
    const market_value = round(s.qty * price)
    const unrealized_pnl = round(market_value - cost_basis)
    return {
      account_id: s.account_id, symbol: s.symbol, currency: s.currency,
      quantity: s.qty, average_cost: s.cost, cost_basis, price, market_value, unrealized_pnl,
      unrealized_pct: round((unrealized_pnl / cost_basis) * 100),
      status: 'ok', first_buy_at: null, incomplete_history: false,
    }
  })
  const totals = [...new Set(positions.map((p) => p.currency))].sort().map((currency) => {
    const rows = positions.filter((p) => p.currency === currency)
    const cost_basis = rows.reduce((a, p) => a + (p.cost_basis ?? 0), 0)
    const market_value = rows.reduce((a, p) => a + (p.market_value ?? 0), 0)
    const unrealized_pnl = market_value - cost_basis
    return { currency, cost_basis, market_value, unrealized_pnl, unrealized_pct: (unrealized_pnl / cost_basis) * 100 }
  })
  return { as_of: new Date().toISOString(), positions, totals }
}
