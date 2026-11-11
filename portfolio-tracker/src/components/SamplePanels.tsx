import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { CALENDAR, ROOM } from '../demo/calendar'
import type { Story } from '../demo/news'
import { useAccounts } from '../hooks/useAccounts'
import { daysFromToday, shortDay } from '../lib/dates'
import { dir, num, qty, signedPct } from '../lib/format'
import { rowIn } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { holdingHash } from '../lib/route'
import { moveOf, storyTime } from '../lib/samples'
import type { PortfolioSnapshot } from '../types'
import { SampleTag } from './ui/SampleTag'

export function NewsRows({ stories, snapshot, showSymbol = true }: {
  stories: Story[]; snapshot: PortfolioSnapshot | null; showSymbol?: boolean
}) {
  const cols = showSymbol ? '64px minmax(0, 1fr) 112px 128px' : '88px minmax(0, 1fr) 112px'
  return (
    <div className="tb nw" style={{ '--cols': cols } as CSSProperties}>
      {stories.map((s, i) => {
        const move = moveOf(snapshot, s.symbol)
        return (
          <motion.div key={`${s.symbol}${s.daysAgo}${s.time}`} className="tr hv" {...rowIn(i)}>
            <span className="m">{storyTime(s)}</span>
            <span className="L" style={{ fontWeight: 500 }}>{s.headline}</span>
            <span className="m L src">{s.source}</span>
            {showSymbol && (
              <span>
                <a href={holdingHash(s.symbol)} className="sym">{displaySymbol(s.symbol)}</a>{' '}
                <span className={dir(move)}>{signedPct(move)}</span>
              </span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

/** Contribution room for the registered account types you have (all of them before any is linked). */
export function ContributionRoom({ columns }: { columns: 'short' | 'full' }) {
  const { list } = useAccounts()
  const types = new Set(list.map((a) => a.account_type.toUpperCase()))
  const rows = ROOM.some((r) => types.has(r.type)) ? ROOM.filter((r) => types.has(r.type)) : ROOM
  const full = columns === 'full'
  return (
    <div className="tb" style={{ '--cols': full ? 'minmax(0, 1fr) 80px 88px 88px' : 'minmax(0, 1fr) 96px 96px' } as CSSProperties}>
      <div className="tr th"><span>Account</span>{full && <span>Limit</span>}<span>Used</span><span>{full ? 'Left' : 'Remaining'}</span></div>
      {rows.map((r) => (
        <div key={r.type} className="tr">
          <span>{r.type}</span>
          {full && <span>{num(r.limit, 0)}</span>}
          <span>{num(r.used, full ? 0 : 2)}</span>
          <span>{num(r.limit - r.used, full ? 0 : 2)}</span>
        </div>
      ))}
    </div>
  )
}

export function RoomHeading() {
  return <h2>Contribution room, {new Date().getFullYear()} <SampleTag what="Contribution room" /></h2>
}

/** Economic releases plus dividends and earnings for what you hold (sample calendar). */
export function Upcoming({ snapshot, limit, withAmounts = true }: { snapshot: PortfolioSnapshot | null; limit: number; withAmounts?: boolean }) {
  const held = new Map<string, number>()
  for (const p of snapshot?.positions ?? []) held.set(p.symbol, (held.get(p.symbol) ?? 0) + (p.quantity ?? 0))
  const events = CALENDAR.filter((e) => e.macro || held.has(e.symbol!)).slice(0, limit)
  return (
    <div className="tb" style={{ '--cols': withAmounts ? '76px minmax(0, 1fr) 84px' : '76px minmax(0, 1fr)' } as CSSProperties}>
      {withAmounts && <div className="tr th"><span>Date</span><span className="L">Event</span><span>Amount</span></div>}
      {events.map((e, i) => {
        const shares = e.symbol ? held.get(e.symbol) ?? 0 : 0
        const sym = e.symbol ? displaySymbol(e.symbol) : ''
        const what = e.macro ?? (e.kind === 'dividend'
          ? withAmounts ? `${sym} dividend · ${qty(shares)} × ${num(e.perShare!, e.perShare! < 1 ? 4 : 2)}` : `${sym} dividend · you hold ${qty(shares)}`
          : `${sym} earnings${withAmounts ? '' : ` · you hold ${qty(shares)}`}`)
        return (
          <motion.div key={`${e.inDays}${what}`} className="tr" {...rowIn(i)}>
            <span className={withAmounts ? '' : 'm'}>{shortDay(daysFromToday(e.inDays))}</span>
            <span className="L">{what}</span>
            {withAmounts && <span className={e.kind === 'dividend' ? '' : 'm'}>{e.kind === 'dividend' ? num(shares * e.perShare!) : '—'}</span>}
          </motion.div>
        )
      })}
    </div>
  )
}
