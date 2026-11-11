import { AnimatePresence, motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import { Upcoming } from '../components/SamplePanels'
import { SampleTag } from '../components/ui/SampleTag'
import { Tabs } from '../components/ui/Tabs'
import { COMPANY_NEWS, MARKET_NEWS, type Story } from '../demo/news'
import type { IndexRow } from '../hooks/useIndices'
import { dayHeading } from '../lib/dates'
import { dir, num, signed, signedPct } from '../lib/format'
import { enter, exit, rowIn } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { hashFor, holdingHash } from '../lib/route'
import { moveOf, storiesFor } from '../lib/samples'
import type { PortfolioSnapshot } from '../types'

const FEEDS = ['Your holdings', 'Market', 'Watchlist'] as const
type Feed = typeof FEEDS[number]

function watchlist(): string[] {
  try { return JSON.parse(localStorage.getItem('investiq.watchlist') ?? '[]') as string[] } catch { return [] }
}

export function News({ snapshot, indices }: { snapshot: PortfolioSnapshot | null; indices: IndexRow[] }) {
  const [feed, setFeed] = useState<Feed>('Your holdings')
  const [query, setQuery] = useState('')
  const watched = new Set(watchlist())
  const source: Story[] = feed === 'Your holdings' ? storiesFor(snapshot)
    : feed === 'Market' ? MARKET_NEWS
    : COMPANY_NEWS.filter((s) => watched.has(s.symbol))
  const q = query.trim().toLowerCase()
  const stories = q ? source.filter((s) => s.headline.toLowerCase().includes(q) || displaySymbol(s.symbol).toLowerCase().includes(q)) : source
  const positions = new Set(snapshot?.positions.map((p) => p.symbol) ?? []).size
  const sub = feed === 'Your holdings' ? `matched to your ${positions} positions` : feed === 'Market' ? 'TSX and US markets' : 'on your watchlist'

  // A day heading before the first story of each day.
  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <h1>News</h1>
          <span className="m">{stories.length} stories · {sub}</span>
        </div>
        <input className="srch" type="search" placeholder="Filter headlines or symbols" aria-label="Filter headlines or symbols"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="grid">
        <section className="p c8">
          <Tabs label="News feed" value={feed} options={FEEDS} onChange={setFeed} />
          <div className="ph" style={{ height: 32 }}><span className="m" style={{ fontSize: 12 }}>Headlines are placeholders until a news source is connected.</span><SampleTag what="The news feed" /></div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={`${feed}|${q}`} className="tb nw" style={{ '--cols': '64px minmax(0, 1fr) 112px 132px' } as CSSProperties}
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: enter }} exit={{ opacity: 0, transition: exit }}>
              {stories.length === 0 && (
                <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>
                  {feed === 'Watchlist' && !q ? 'Add symbols to your watchlist from their page to follow them here.' : 'No stories match.'}
                </span></div>
              )}
              {stories.flatMap((s, i) => {
                const out = []
                // A day heading before the first story of each day.
                if (i === 0 || stories[i - 1].daysAgo !== s.daysAgo) {
                  out.push(<div key={`d${s.daysAgo}`} className="tr day"><span>{dayHeading(s.daysAgo)}</span></div>)
                }
                const move = moveOf(snapshot, s.symbol)
                out.push(
                  <motion.div key={`${s.symbol}${s.daysAgo}${s.time}`} className="tr hv" {...rowIn(i)}>
                    {/* The day heading carries the date, so rows show the time. */}
                    <span className="m">{s.time}</span>
                    <span className="L" style={{ fontWeight: 500 }}>{s.headline}</span>
                    <span className="m L src">{s.source}</span>
                    <span><a href={holdingHash(s.symbol)} className="sym">{displaySymbol(s.symbol)}</a> <span className={dir(move)}>{signedPct(move)}</span></span>
                  </motion.div>,
                )
                return out
              })}
            </motion.div>
          </AnimatePresence>
        </section>

        <div className="c4 col">
          <section className="p">
            <div className="ph"><h2>Markets {indices.some((i) => i.sample) && <SampleTag what="Part of this panel" />}</h2><a href={hashFor('markets')}>Market map</a></div>
            <div className="tb" style={{ '--cols': 'minmax(0, 1fr) 96px 72px' } as CSSProperties}>
              <div className="tr th"><span>Index</span><span>Last</span><span>Change</span></div>
              {indices.map((r, i) => (
                <motion.div key={r.name} className="tr" title={r.sample ? 'Sample figure' : undefined} {...rowIn(i)}>
                  <span>{r.name}</span><span>{num(r.last, r.digits)}</span>
                  <span className={dir(r.change)}>{r.absolute ? signed(r.change, 3) : signedPct(r.change)}</span>
                </motion.div>
              ))}
            </div>
          </section>
          <section className="p" style={{ flex: 1 }}>
            <div className="ph"><h2>Calendar <SampleTag what="The calendar" /></h2></div>
            <Upcoming snapshot={snapshot} limit={8} withAmounts={false} />
          </section>
        </div>
      </div>
    </>
  )
}
