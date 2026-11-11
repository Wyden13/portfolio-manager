import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { CALENDAR, ROOM } from '../demo/calendar'
import type { Story } from '../demo/news'
import { useAccounts } from '../hooks/useAccounts'
import { daysFromToday, shortDay } from '../lib/dates'
import { dir, num, qty, signedPct } from '../lib/format'
import { enter, rowIn, staggerDelay } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { holdingHash } from '../lib/route'
import { moveOf, storyTime } from '../lib/samples'
import type { PortfolioSnapshot } from '../types'
import { SampleTag } from './ui/SampleTag'

export function NewsRows({ stories, snapshot, showSymbol = true }: {
  stories: Story[]; snapshot: PortfolioSnapshot | null; showSymbol?: boolean
}) {
  return (
    <div className="tb nw" style={{ '--cols': showSymbol ? 'minmax(0, 1fr) 140px' : 'minmax(0, 1fr)' } as CSSProperties}>
      {stories.map((s, i) => {
        const move = moveOf(snapshot, s.symbol)
        return (
          <motion.div key={`${s.symbol}${s.daysAgo}${s.time}`} className="tr story" {...rowIn(i)}>
            <div className="two">
              <span className="m" style={{ fontSize: 12 }}><span className="src">{s.source} · </span>{storyTime(s)}</span>
              <span style={{ fontWeight: 600 }}>{s.headline}</span>
            </div>
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
export function ContributionRoom({ variant }: { variant: 'list' | 'bars' }) {
  const { list } = useAccounts()
  const types = new Set(list.map((a) => a.account_type.toUpperCase()))
  const rows = ROOM.some((r) => types.has(r.type)) ? ROOM.filter((r) => types.has(r.type)) : ROOM
  if (variant === 'list') {
    return rows.map((r, i) => (
      <motion.div key={r.type} className="li" {...rowIn(i)}>
        <span className="two"><span className="b">{r.type}</span><span className="m small">{num(r.used, 0)} of {num(r.limit, 0)} used</span></span>
        <span className="b">${num(r.limit - r.used)}</span>
      </motion.div>
    ))
  }
  return rows.map((r, i) => (
    <motion.div key={r.type} className="stack" style={{ gap: 8, padding: '14px 20px', borderTop: '1px solid var(--line)' }} {...rowIn(i)}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="b">{r.type}</span><span><span className="b">${num(r.limit - r.used)}</span> <span className="m">left</span></span>
      </div>
      <div className="bar">
        <motion.i style={{ width: `${Math.min(100, (r.used / r.limit) * 100)}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
          transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />
      </div>
      <span className="m small">${num(r.used, 0)} of ${num(r.limit, 0)} used</span>
    </motion.div>
  ))
}

export function RoomHeading() {
  return <h3>Contribution room, {new Date().getFullYear()} <SampleTag what="Contribution room" /></h3>
}

/** Economic releases plus dividends and earnings for what you hold (sample calendar). */
export function Upcoming({ snapshot, limit, withAmounts = true }: { snapshot: PortfolioSnapshot | null; limit: number; withAmounts?: boolean }) {
  const held = new Map<string, number>()
  for (const p of snapshot?.positions ?? []) held.set(p.symbol, (held.get(p.symbol) ?? 0) + (p.quantity ?? 0))
  const events = CALENDAR.filter((e) => e.macro || held.has(e.symbol!)).slice(0, limit)
  const cols = { '--cols': withAmounts ? '56px minmax(0, 1fr) auto' : '56px minmax(0, 1fr)' } as CSSProperties
  return events.map((e, i) => {
    const shares = e.symbol ? held.get(e.symbol) ?? 0 : 0
    const sym = e.symbol ? displaySymbol(e.symbol) : ''
    const what = e.macro ?? (e.kind === 'dividend'
      ? withAmounts ? `${sym} dividend` : <><span className="b">{sym}</span> dividend · you hold {qty(shares)}</>
      : withAmounts ? `${sym} earnings` : <><span className="b">{sym}</span> earnings · you hold {qty(shares)}</>)
    return (
      <motion.div key={`${e.inDays}${e.macro ?? e.symbol}${e.kind}`} className="li" style={cols} {...rowIn(i)}>
        <span className="m">{shortDay(daysFromToday(e.inDays))}</span>
        <span className="L">{what}</span>
        {withAmounts && (e.kind === 'dividend' ? <span className="b" title={`${qty(shares)} × ${num(e.perShare!, e.perShare! < 1 ? 4 : 2)}`}>${num(shares * e.perShare!)}</span> : <span className="m">—</span>)}
      </motion.div>
    )
  })
}
