/** ok: priced with P&L. no_cost: priced, but the broker reported no cost basis (no P&L).
 *  no_quote / currency_mismatch: no usable live price. */
export type PositionStatus = 'ok' | 'no_cost' | 'no_quote' | 'currency_mismatch'
/** Where quantity and cost come from: stored transactions, or the broker's own position report. */
export type CostSource = 'transactions' | 'broker'
/** From Yahoo's quote type; `other` when it couldn't be classified. */
export type AssetClass = 'stock' | 'etf' | 'fund' | 'other'

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
  asset_class: AssetClass
  /** Price vs the last session's close; null without a quote or a close. */
  day_change_pct: number | null
  /** Shares traded this session; null without a quote. */
  volume: number | null
}

/** GET /api/holdings/profiles: what each held listing is (from Yahoo, refreshed daily). */
export interface SecurityProfile {
  asset_class: AssetClass
  name: string | null
  sector: string | null
  industry: string | null
  country: string | null
  market_cap: number | null
  market_cap_currency: string | null
  /** Trailing P/E; null when there are no earnings (or for funds). */
  pe: number | null
  website: string | null
}

/** Cash computed from the stored activity history, in its own currency. */
export interface CashBalance {
  currency: string
  amount: number
  /** The stored history may not reach back to the account's opening, so the sum may be off. */
  estimated: boolean
}

/** One account in the base currency at spot FX. */
export interface AccountSummary {
  account_id: number
  /** Holdings with a live price, cost basis or not. */
  market_value: number
  cost_basis: number
  unrealized_pnl: number
  unrealized_pct: number | null
  cash: CashBalance[]
  cash_value: number
  /** market_value + cash_value */
  total: number
  holdings: number
  /** False when a currency had no FX rate and was left out. */
  complete: boolean
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
  accounts: AccountSummary[]
  /** Currency of base_total, accounts and the *_base fields; null when FX isn't available. */
  base_currency: string | null
  /** Across all accounts; null when a rate is missing. */
  cash_base: number | null
  total_assets_base: number | null
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

export type HistoryRange = '1M' | '3M' | '6M' | '1Y' | '5Y' | 'ALL'
export type HistoryInterval = '1d' | '1wk' | '1mo'

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

/** GET /api/portfolio/value/accounts?range=: holdings plus cash, at today's spot FX. */
export interface AccountValueHistoryResponse {
  currency: string
  range: HistoryRange
  interval: HistoryInterval
  accounts: Array<{ account_id: number; points: ValuePoint[] }>
  total: ValuePoint[]
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

export type ConnectionStatus = 'pending' | 'active' | 'needs_reauth' | 'error'
export type Platform = 'questrade' | 'snaptrade'

export interface ConnectionAccount {
  id: number
  account_type: string
  /** Masked, e.g. ••1234 */
  account_number: string
  removed: boolean
  /** Mirrors a directly connected account, so it is left out of totals. */
  duplicate: boolean
}

export interface Connection {
  platform: Platform
  status: ConnectionStatus
  last_error: string | null
  last_synced_at: string | null
  institutions: Array<{ name: string; accounts: ConnectionAccount[] }>
}

export interface ConnectionsOverview {
  /** Which sign-in flows the server is configured for. */
  options: { questrade_oauth: boolean; snaptrade: boolean }
  connections: Connection[]
}

export type BrokerageId = 'questrade' | 'wealthsimple'

/** A brokerage the connect picker offers. */
export interface BrokerageOption {
  id: BrokerageId
  name: string
  /** Questrade connects directly; Wealthsimple through SnapTrade's portal. */
  method: 'direct' | 'snaptrade'
  /** Official logo from SnapTrade, when it is reachable. */
  logo_url: string | null
  /** Off when the server lacks the credentials this method needs. */
  available: boolean
  connected: boolean
  /** Questrade: whether the OAuth sign-in is configured (the App Hub token always works). */
  oauth?: boolean
  /** Wealthsimple: SnapTrade's broker slug, preselected in the portal. */
  snaptrade_slug?: string | null
}

export interface BrokerageCatalog {
  options: BrokerageOption[]
  /** Logos for linked institutions, by institution name. */
  institution_logos: Record<string, string>
}
