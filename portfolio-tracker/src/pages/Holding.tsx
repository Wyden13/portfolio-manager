import { motion } from 'motion/react'
import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fetchHistory } from '../api/client'
import { AreaChart, type Point } from '../components/AreaChart'
import { Icon } from '../components/Icon'
import { NewsRows } from '../components/SamplePanels'
import { TickerLogo } from '../components/TickerLogo'
import { IconSwap } from '../components/ui/IconSwap'
import { Popover } from '../components/ui/Popover'
import { RangeGroup } from '../components/ui/RangeGroup'
import { SampleTag } from '../components/ui/SampleTag'
import { LISTINGS } from '../demo/market'
import { COMPANY_NEWS } from '../demo/news'
import { useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { clock, longDay, month, shortDay, year } from '../lib/dates'
import { abbrev, dir, num, qty, share, signed, signedPct } from '../lib/format'
import { holdingRows, type Profiles } from '../lib/holdings'
import { enter, rowIn, staggerDelay } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { hashFor } from '../lib/route'
import type { Candle, HistoryInterval, HistoryRange, PortfolioSnapshot } from '../types'

const RANGES = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y'] as const
type Range = typeof RANGES[number]
const FETCH: Record<Exclude<Range, '1D'>, [HistoryRange, HistoryInterval]> = {
  '5D': ['1M', '1d'], '1M': ['1M', '1d'], '6M': ['6M', '1d'], YTD: ['1Y', '1d'], '1Y': ['1Y', '1d'], '5Y': ['5Y', '1wk'],
}
const LABEL: Record<Range, string> = { '1D': 'Today', '5D': 'Past 5 days', '1M': 'Past month', '6M': 'Past 6 months', YTD: 'Year to date', '1Y': 'Past year', '5Y': 'Past 5 years' }
const TICK: Record<Range, (t: number) => string> = { '1D': clock, '5D': shortDay, '1M': shortDay, '6M': month, YTD: month, '1Y': month, '5Y': year }

const exchangeOf = (symbol: string) =>
  /\.TO$/i.test(symbol) ? 'TSX' : /\.VN?$/i.test(symbol) ? 'TSXV' : /\.CN$/i.test(symbol) ? 'CSE' : /\.NE$/i.test(symbol) ? 'Cboe Canada'
    : LISTINGS.get(symbol)?.exchange ?? null

const WATCH_KEY = 'investiq.watchlist'
function readWatchlist(): string[] {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) ?? '[]') as string[] } catch { return [] }
}

/** Saved in this browser only: there is no watchlist on the server yet. */
function useWatchlist(symbol: string): [boolean, () => void] {
  const [list, setList] = useState(readWatchlist)
  const toggle = useCallback(() => {
    setList((l) => {
      const next = l.includes(symbol) ? l.filter((s) => s !== symbol) : [...l, symbol]
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)) } catch { /* not remembered */ }
      return next
    })
  }, [symbol])
  return [list.includes(symbol), toggle]
}

function slice(range: Range, candles: Candle[]): Candle[] {
  if (range === '5D') return candles.slice(-5)
  if (range === 'YTD') {
    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000
    return candles.filter((c) => c.time >= jan1)
  }
  return candles
}

function PriceAlert() {
  const wrap = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <div className="pop-wrap" ref={wrap}>
      <button type="button" className="btn o" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="bell" />Price alert</button>
      <Popover open={open} onClose={close} wrapRef={wrap} align="right" label="Price alert">
        <div style={{ padding: 12, width: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong>Price alerts aren’t available yet</strong>
          <span className="m">InvestIQ can’t send notifications yet. This button is a placeholder from the design.</span>
        </div>
      </Popover>
    </div>
  )
}

export function Holding({ symbol, snapshot, profiles }: { symbol: string; snapshot: PortfolioSnapshot | null; profiles: Profiles }) {
  const { get } = useAccounts()
  const [range, setRange] = useState<Range>('1Y')
  const [watching, toggleWatch] = useWatchlist(symbol)
  const [apiRange, interval] = range === '1D' ? FETCH['1M'] : FETCH[range]
  const chart = useAsync(`hist:${symbol}:${apiRange}:${interval}`, (s) => fetchHistory(symbol, apiRange, interval, s))
  const year1 = useAsync(`hist:${symbol}:1Y:1d`, (s) => fetchHistory(symbol, '1Y', '1d', s))

  const row = useMemo(() => (snapshot ? holdingRows(snapshot, profiles).find((r) => r.symbol === symbol) ?? null : null), [snapshot, profiles, symbol])
  const profile = profiles[symbol] ?? null
  const listing = LISTINGS.get(symbol)
  const name = profile?.name ?? listing?.name ?? displaySymbol(symbol)

  const candles = chart.status === 'ready' ? slice(range, chart.data.candles) : []
  const points: Point[] = candles.map((c) => ({ t: c.time, v: c.close }))
  const daily = year1.status === 'ready' ? year1.data.candles : []
  const lastBar = daily.at(-1)
  const price = row?.price ?? lastBar?.close ?? null
  const pct = row?.dayChangePct ?? (daily.length >= 2 ? ((daily.at(-1)!.close - daily.at(-2)!.close) / daily.at(-2)!.close) * 100 : null)
  const prevClose = price !== null && pct !== null ? price / (1 + pct / 100) : null
  const change = price !== null && prevClose !== null ? price - prevClose : null
  const currency = row?.currency ?? (chart.status === 'ready' ? chart.data.currency : '')
  const first = points[0]?.v
  const rangeChg = first !== undefined && points.length ? points.at(-1)!.v - first : null
  const costInRange = row?.averageCost ?? null
  const dayPnl = row?.marketValue != null && pct !== null ? (row.marketValue * pct) / (100 + pct) : null
  const vol3m = daily.slice(-63)
  const avgVol = vol3m.length ? vol3m.reduce((a, c) => a + c.volume, 0) / vol3m.length : null
  const hi52 = daily.length ? Math.max(...daily.map((c) => c.high)) : null
  const lo52 = daily.length ? Math.min(...daily.map((c) => c.low)) : null

  const stats: Array<[string, string]> = [
    ['Previous close', num(prevClose)],
    ['Open', num(lastBar?.open)],
    ['Day range', lastBar ? `${num(lastBar.low)} – ${num(lastBar.high)}` : '—'],
    ['52-week range', hi52 !== null ? `${num(lo52)} – ${num(hi52)}` : '—'],
    ['Volume', num(row?.volume ?? lastBar?.volume ?? null, 0)],
    ['Avg. volume, 3M', num(avgVol, 0)],
    ['Market cap', abbrev(profile?.market_cap ?? listing?.cap)],
    ['Beta, 5Y monthly', '—'],
    ['P/E, TTM', num(profile?.pe ?? listing?.pe, 1)],
    ['EPS, TTM', '—'],
  ]
  const stories = COMPANY_NEWS.filter((s) => s.symbol === symbol)
  const sector = profile?.sector ?? listing?.sector

  return (
    <>
      <nav className="crumb m" aria-label="Breadcrumb">
        <a href={hashFor('markets')}>Markets</a><span>/</span>
        {sector && <><a href={hashFor('markets')}>{sector}</a><span>/</span></>}
        <span style={{ color: 'var(--ink)' }}>{displaySymbol(symbol)}</span>
      </nav>

      <div className="page-head">
        <div className="page-title" style={{ gap: 6 }}>
          <div className="page-title">
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TickerLogo symbol={symbol} website={profile?.website} />
              <span>{name} (<motion.span layoutId={`sym-${symbol}`} style={{ display: 'inline-block' }}>{displaySymbol(symbol)}</motion.span>)</span>
            </h1>
            <span className="m">{[exchangeOf(symbol), currency, sector, profile?.industry].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="quote">
            <span className="quote-px">{num(price)}</span>
            <span className={`quote-chg ${dir(change)}`}>{signed(change)} ({signedPct(pct)})</span>
            <span className="m" style={{ fontSize: 12 }}>{row && snapshot ? `At ${clock(snapshot.as_of)} · live` : lastBar ? `Last close ${longDay(lastBar.time)}` : ''}</span>
          </div>
        </div>
        <div className="actions">
          <PriceAlert />
          <button type="button" className="btn o" aria-pressed={watching} onClick={toggleWatch} title="Saved in this browser">
            <IconSwap id={watching ? 'on' : 'off'}><Icon name={watching ? 'starFilled' : 'star'} /></IconSwap>
            {watching ? 'On watchlist' : 'Add to watchlist'}
          </button>
        </div>
      </div>

      <div className="grid">
        <section className="p c8">
          <div className="ph">
            <h2>Price</h2>
            <RangeGroup label="Chart range" value={range} options={RANGES} onChange={setRange}
              unavailable={(r) => (r === '1D' ? 'Intraday prices aren’t available yet' : null)} />
          </div>
          <div className="chart-body">
            <div className="chart-meta">
              <span><span className="m">{LABEL[range]}</span>{' '}
                <span className={dir(rangeChg)} style={{ fontWeight: 600 }}>
                  {rangeChg === null ? '' : `${signed(rangeChg)} (${signedPct(first ? (rangeChg / first) * 100 : null)})`}
                </span>
              </span>
              {costInRange !== null && <span className="m"><span className="cost-key" />Your avg cost {num(costInRange)}</span>}
            </div>
            {points.length >= 2 ? (
              <AreaChart points={points} height={272} tone={rangeChg !== null && rangeChg < 0 ? 'dn' : 'up'} label={`${displaySymbol(symbol)} price over the selected range`}
                formatTime={TICK[range]} reference={costInRange !== null ? { value: costInRange, kind: 'cost' } : undefined}
                volume={candles.map((c) => c.volume)} seriesKey={`${symbol}:${range}`} />
            ) : (
              <div className="state" style={{ minHeight: 340 }} role={chart.status === 'error' ? 'alert' : 'status'}>
                {chart.status === 'error' ? `No price history for ${displaySymbol(symbol)}.` : 'Loading prices…'}
              </div>
            )}
          </div>
        </section>

        <section className="p c4">
          <div className="ph"><h2>Your position</h2><a href={hashFor('accounts')}>Accounts</a></div>
          {row ? (
            <>
              <div className="tb" style={{ '--cols': 'minmax(0, 1fr) auto' } as CSSProperties}>
                {([
                  ['Shares', qty(row.quantity), ''],
                  ['Average cost', num(row.averageCost), ''],
                  ['Market value', num(row.marketValue), ''],
                  ['Book cost', num(row.costBasis), ''],
                  ['Unrealized P/L', `${signed(row.pnl)} (${signedPct(row.pnlPct, 1)})`, dir(row.pnl)],
                  ['Day P/L', signed(dayPnl), dir(dayPnl)],
                  ['Portfolio weight', share(row.weight), ''],
                ] as const).map(([k, v, cls], i) => (
                  <motion.div key={k} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: staggerDelay(i) }}>
                    <span className="m">{k}</span><span className={cls}>{v}</span>
                  </motion.div>
                ))}
              </div>
              <div className="ph top"><h2>By account</h2></div>
              <div className="tb" style={{ '--cols': 'minmax(0, 1fr) 64px 80px 96px' } as CSSProperties}>
                <div className="tr th"><span>Account</span><span>Qty</span><span>Avg cost</span><span>Value</span></div>
                {row.children.map((c, i) => {
                  const a = get(c.accountIds[0])
                  return (
                    <motion.div key={c.key} className="tr" {...rowIn(i)}>
                      <span>{a ? `${a.account_type} · ${a.institution}` : `Account ${c.accountIds[0]}`}</span>
                      <span>{qty(c.quantity)}</span><span>{num(c.averageCost)}</span><span>{num(c.marketValue)}</span>
                    </motion.div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="state">You don’t hold {displaySymbol(symbol)} in any linked account.</div>
          )}
        </section>

        <section className="p c8">
          <div className="ph"><h2>News <SampleTag what="News" /></h2><a href={hashFor('news')}>More news</a></div>
          {stories.length ? <NewsRows stories={stories} snapshot={snapshot} showSymbol={false} />
            : <div className="state">No sample stories for {displaySymbol(symbol)}.</div>}
        </section>

        <section className="p c4">
          <div className="ph"><h2>Key statistics</h2>{!profile && listing && <SampleTag what="Market cap and P/E" />}</div>
          <div className="tb" style={{ '--cols': 'minmax(0, 1fr) auto' } as CSSProperties}>
            {stats.map(([k, v], i) => (
              <motion.div key={k} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: staggerDelay(i) }}>
                <span className="m">{k}</span><span title={v === '—' ? 'Not available from the current data source' : undefined}>{v}</span>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
