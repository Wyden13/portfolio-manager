import { ROOM } from '../demo/calendar'
import { LISTINGS } from '../demo/market'
import { COMPANY_NEWS, type Story } from '../demo/news'
import type { PortfolioSnapshot } from '../types'
import { daysFromToday, shortDay } from './dates'

/** Today's move for a symbol: the live quote when you hold it, else the sample listing's. */
export function moveOf(snapshot: PortfolioSnapshot | null, symbol: string): number | null {
  const held = snapshot?.positions.find((p) => p.symbol === symbol && p.day_change_pct !== null)
  return held ? held.day_change_pct : LISTINGS.get(symbol)?.change ?? null
}

/** Sample headlines about what you hold (all company news when nothing matches). */
export function storiesFor(snapshot: PortfolioSnapshot | null): Story[] {
  const held = new Set(snapshot?.positions.map((p) => p.symbol) ?? [])
  const mine = COMPANY_NEWS.filter((s) => held.has(s.symbol))
  return mine.length ? mine : COMPANY_NEWS
}

export const storyTime = (s: Story) => (s.daysAgo === 0 ? s.time : shortDay(daysFromToday(-s.daysAgo)))

/** Room left for one account type, from the sample limits; null for unregistered accounts. */
export function roomLeft(accountType: string | undefined): number | null {
  const r = ROOM.find((x) => x.type === accountType?.toUpperCase())
  return r ? r.limit - r.used : null
}
