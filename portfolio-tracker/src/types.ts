/** ok: priced with P&L. no_cost: priced, but the broker reported no cost basis (no P&L).
 *  no_quote / currency_mismatch: no usable live price. */
export type PositionStatus = 'ok' | 'no_cost' | 'no_quote' | 'currency_mismatch'
/** Where quantity and cost come from: stored transactions, or the broker's own position report. */
export type CostSource = 'transactions' | 'broker'

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
  source: CostSource
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
  /** All totals converted into the server's base currency at spot FX; null when a rate is missing. */
  base_total: CurrencyTotal | null
  /** Base-currency units per one unit of each currency. */
  fx_rates: Record<string, number>
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

/** GET /api/history/{ticker}?range=&interval= */
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

/** GET /api/portfolio/value?range=&currency= */
export interface ValueHistoryResponse {
  currency: string
  range: HistoryRange
  points: ValuePoint[]
}

export type TransactionKind = 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'DEPOSIT' | 'WITHDRAWAL' | 'OTHER'

/** One row of GET /api/transactions. */
export interface LedgerEntry {
  id: number
  account_id: number
  institution: string
  platform: string
  account_type: string
  /** masked, e.g. ••4567 */
  account_number: string
  kind: TransactionKind
  symbol: string | null
  /** naive UTC ISO timestamp */
  trade_date: string
  quantity: number
  price: number
  fee: number
  gross_amount: number
  net_amount: number
  currency: string
  description: string
}

export interface LedgerPage {
  items: LedgerEntry[]
  total: number
  limit: number
  offset: number
}

/** One row of GET /api/ledger/accounts. */
export interface LinkedAccount {
  id: number
  institution: string
  platform: string
  account_type: string
  account_number: string
  removed: boolean
}
