/**
 * SAMPLE DATA. No dividend, earnings or economic calendar is wired up yet. Dates are days from
 * today; per-share amounts are illustrative.
 */

export interface CalendarEvent {
  inDays: number
  /** Economic release or rate decision. */
  macro?: string
  /** Yahoo symbol of a holding's event. */
  symbol?: string
  kind?: 'dividend' | 'earnings'
  /** Dividend per share, in the listing's currency. */
  perShare?: number
}

export const CALENDAR: CalendarEvent[] = [
  { inDays: 2, macro: 'US CPI, October' },
  { inDays: 7, macro: 'Canada CPI, October' },
  { inDays: 13, symbol: 'RY.TO', kind: 'dividend', perShare: 1.54 },
  { inDays: 16, symbol: 'AAPL', kind: 'dividend', perShare: 0.26 },
  { inDays: 20, symbol: 'ENB.TO', kind: 'dividend', perShare: 0.9425 },
  { inDays: 23, symbol: 'TD.TO', kind: 'earnings' },
  { inDays: 25, symbol: 'CNR.TO', kind: 'dividend', perShare: 0.8875 },
  { inDays: 29, macro: 'Bank of Canada rate decision' },
]

/** SAMPLE DATA. Annual registered-account limits and room used (no contribution tracking yet). */
export const ROOM: Array<{ type: string; limit: number; used: number }> = [
  { type: 'TFSA', limit: 7000, used: 1000 },
  { type: 'RRSP', limit: 32500, used: 17650 },
  { type: 'FHSA', limit: 8000, used: 8000 },
]
