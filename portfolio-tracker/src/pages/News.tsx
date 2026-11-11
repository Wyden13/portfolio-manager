import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import { Upcoming } from '../components/SamplePanels'
import { SampleTag } from '../components/ui/SampleTag'
import { Tabs } from '../components/ui/Tabs'
import { MARKET_NEWS, type Story } from '../demo/news'
import type { IndexRow } from '../hooks/useIndices'
import { dayHeading } from '../lib/dates'
import { dir, num, signed, signedPct } from '../lib/format'
import { enter, exit, rowIn } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { hashFor, holdingHash } from '../lib/route'
import { moveOf, storiesFor } from '../lib/samples'
import type { PortfolioSnapshot } from '../types'

const FEEDS = ['Your holdings', 'Market'] as const
type Feed = typeof FEEDS[number]

export function News({ snapshot, indices }: { snapshot: PortfolioSnapshot | null; indices: IndexRow[] }) {
  const [feed, setFeed] = useState<Feed>('Your holdings')
  const stories: Story[] = feed === 'Your holdings' ? storiesFor(snapshot) : MARKET_NEWS
  const positions = new Set(snapshot?.positions.map((p) => p.symbol) ?? []).size
  const sub = feed === 'Your holdings' ? `matched to your ${positions} positions` : 'TSX and US markets'

  return (
    <div className="layout">
      <div className="main tight">
        <div className="page-head">
          <div className="page-title">
            <h1>News</h1>
            <span className="m">{stories.length} stories · {sub}</span>
          </div>
          <span className="m small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Headlines are placeholders until a news source is connected. <SampleTag what="The news feed" />
          </span>
        </div>

        <section>
          <Tabs label="News feed" value={feed} options={FEEDS} onChange={setFeed} />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={feed} className="tb nw" style={{ '--cols': 'minmax(0, 1fr) 140px' } as CSSProperties}
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: enter }} exit={{ opacity: 0, transition: exit }}>
              {stories.length === 0 && <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>No stories yet.</span></div>}
              {stories.flatMap((s, i) => {
                const out = []
                // A day heading before the first story of each day.
                if (i === 0 || stories[i - 1].daysAgo !== s.daysAgo) {
                  out.push(<div key={`d${s.daysAgo}`} className="tr day"><span>{dayHeading(s.daysAgo)}</span></div>)
                }
                const move = moveOf(snapshot, s.symbol)
                out.push(
                  <motion.div key={`${s.symbol}${s.daysAgo}${s.time}`} className="tr story" {...rowIn(i)}>
                    {/* The day heading carries the date, so rows show the time. */}
                    <div className="two">
                      <span className="m" style={{ fontSize: 12 }}><span className="src">{s.source} · </span>{s.time}</span>
                      <span style={{ fontWeight: 600 }}>{s.headline}</span>
                    </div>
                    <span><a href={holdingHash(s.symbol)} className="sym">{displaySymbol(s.symbol)}</a> <span className={dir(move)}>{signedPct(move)}</span></span>
                  </motion.div>,
                )
                return out
              })}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>

      <aside className="rail">
        <section className="card">
          <div className="ch"><h3>Markets {indices.some((i) => i.sample) && <SampleTag what="Part of this panel" />}</h3><a href={hashFor('markets')}>Market map</a></div>
          {indices.map((r, i) => (
            <motion.div key={r.name} className="li" style={{ '--cols': 'minmax(0, 1fr) 88px 64px' } as CSSProperties} title={r.sample ? 'Sample figure' : undefined} {...rowIn(i)}>
              <span>{r.name}</span><span className="b">{num(r.last, r.digits)}</span>
              <span className={dir(r.change)}>{r.absolute ? signed(r.change, 3) : signedPct(r.change)}</span>
            </motion.div>
          ))}
        </section>
        <section className="card">
          <div className="ch"><h3>Calendar <SampleTag what="The calendar" /></h3></div>
          <Upcoming snapshot={snapshot} limit={8} withAmounts={false} />
        </section>
      </aside>
    </div>
  )
}
