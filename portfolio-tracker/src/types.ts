export type PositionStatus = 'ok' | 'no_quote' | 'currency_mismatch'

export interface Position {
  account_id: number
  symbol: string
  currency: string
  quantity: number | null
  average_cost: number | null
  cost_basis: number | null
  price: number | null
  market_value: number | null
  unrealized_pnl: number | null
  unrealized_pct: number | null
  status: PositionStatus
  first_buy_at: string | null
  incomplete_history: boolean
}

export interface CurrencyTotal {
  currency: string
  cost_basis: number | null
  market_value: number | null
  unrealized_pnl: number | null
  unrealized_pct: number | null
}

/** Shape of GET /api/positions and of every decoded SSE frame. */
export interface PortfolioSnapshot {
  as_of: string
  positions: Position[]
  totals: CurrencyTotal[]
}

export interface Candle {
  /** unix seconds (UTC) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type HistoryRange = '1M' | '3M' | '6M' | '1Y'
export type HistoryInterval = '1d' | '1wk'

/** Contract for the not-yet-built GET /api/history/{ticker}?range=&interval= */
export interface HistoryResponse {
  symbol: string
  currency: string
  range: HistoryRange
  interval: HistoryInterval
  candles: Candle[]
}

export interface ValuePoint {
  /** unix seconds (UTC) */
  time: number
  value: number
}

/** Contract for the not-yet-built GET /api/portfolio/value?range=&currency= */
export interface ValueHistoryResponse {
  currency: string
  range: HistoryRange
  points: ValuePoint[]
}
