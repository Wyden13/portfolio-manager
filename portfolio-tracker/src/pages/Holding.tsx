import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { fetchHistory } from '../api/client'
import { AreaChart, type Point } from '../components/AreaChart'
import { NewsRows } from '../components/SamplePanels'
import { TickerLogo } from '../components/TickerLogo'
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

function slice(range: Range, candles: Candle[]): Candle[] {
  if (range === '5D') return candles.slice(-5)
  if (range === 'YTD') {
    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000
    return candles.filter((c) => c.time >= jan1)
  }
  return candles
}

export function Holding({ symbol, snapshot, profiles }: { symbol: string; snapshot: PortfolioSnapshot | null; profiles: Profiles }) {
  const { get } = useAccounts()
  const [range, setRange] = useState<Range>('1Y')
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
    ['P/E, TTM', num(profile?.pe ?? listing?.pe, 1)],
  ]
  const stories = COMPANY_NEWS.filter((s) => s.symbol === symbol)
  const sector = profile?.sector ?? listing?.sector

  return (
    <div className="layout">
      <div className="main">
        <section className="stack">
          <nav className="crumb m" aria-label="Breadcrumb">
            <a href={hashFor('markets')}>Markets</a><span>/</span>
            {sector && <><a href={hashFor('markets')}>{sector}</a><span>/</span></>}
            <span>{displaySymbol(symbol)}</span>
          </nav>
          <div className="page-title">
            <h1 className="h1" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <TickerLogo symbol={symbol} website={profile?.website} />
              <span>{name}</span>
            </h1>
            <span className="m">
              {/* The ticker carries over from the row that was clicked. */}
              <motion.span layoutId={`sym-${symbol}`} style={{ display: 'inline-block' }}>{displaySymbol(symbol)}</motion.span>
              {[exchangeOf(symbol), currency, sector, profile?.industry].filter(Boolean).map((x) => ` · ${x}`).join('')}
            </span>
          </div>
          <div className="page-title" style={{ gap: 2 }}>
            <span className="big">{price === null ? '—' : `$${num(price)}`}</span>
            <span>
              <span className={`b ${dir(range === '1D' ? change : rangeChg)}`}>
                {range === '1D'
                  ? `${signed(change)} (${signedPct(pct)})`
                  : rangeChg === null ? '' : `${signed(rangeChg)} (${signedPct(first ? (rangeChg / first) * 100 : null)})`}
              </span>{' '}
              <span className="m">{LABEL[range]}</span>
              <span className="m small" style={{ marginLeft: 10 }}>{row && snapshot ? `At ${clock(snapshot.as_of)} · live` : lastBar ? `Last close ${longDay(lastBar.time)}` : ''}</span>
            </span>
          </div>
          {points.length >= 2 ? (
            <AreaChart points={points} height={280} tone={rangeChg !== null && rangeChg < 0 ? 'dn' : 'up'} label={`${displaySymbol(symbol)} price over the selected range`}
              formatTime={TICK[range]} reference={costInRange !== null ? { value: costInRange, kind: 'cost' } : undefined}
              seriesKey={`${symbol}:${range}`} />
          ) : (
            <div className="state" style={{ minHeight: 300 }} role={chart.status === 'error' ? 'alert' : 'status'}>
              {chart.status === 'error' ? `No price history for ${displaySymbol(symbol)}.` : 'Loading prices…'}
            </div>
          )}
          <div className="chart-foot">
            <RangeGroup label="Chart range" value={range} options={RANGES} onChange={setRange}
              unavailable={(r) => (r === '1D' ? 'Intraday prices aren’t available yet' : null)} />
            {costInRange !== null && (
              <span className="m small"><span className="cost-key" />Your average cost <span className="b" style={{ color: 'var(--ink)' }}>{num(costInRange)}</span></span>
            )}
          </div>
        </section>

        <section>
          <div className="sh" style={{ marginBottom: 16 }}><h2>Key statistics {!profile && listing && <SampleTag what="Market cap and P/E" />}</h2></div>
          <div className="stats4">
            {stats.map(([k, v], i) => (
              <motion.div key={k} className="two" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: staggerDelay(i) }}>
                <span className="lab">{k}</span><span className="b" title={v === '—' ? 'Not available from the current data source' : undefined}>{v}</span>
              </motion.div>
            ))}
          </div>
        </section>

        <section>
          <div className="sh"><h2>News <SampleTag what="News" /></h2><a href={hashFor('news')} className="lk">More news</a></div>
          {stories.length ? <NewsRows stories={stories} snapshot={snapshot} showSymbol={false} />
            : <div className="state">No sample stories for {displaySymbol(symbol)}.</div>}
        </section>
      </div>

      <aside className="rail">
        <section className="card">
          <div className="ch"><h3>Your position</h3><a href={hashFor('accounts')}>Accounts</a></div>
          {row ? (
            <>
              <div className="card-pad page-title" style={{ gap: 2 }}>
                <span className="lab">Market value</span>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>{num(row.marketValue)} <span className="m" style={{ fontSize: 14, fontWeight: 500 }}>{row.currency}</span></span>
                <span className={`b small ${dir(row.pnl)}`}>{signed(row.pnl)} ({signedPct(row.pnlPct, 1)}) all time</span>
              </div>
              {([
                ['Shares', qty(row.quantity), ''],
                ['Average cost', num(row.averageCost), ''],
                ['Book cost', num(row.costBasis), ''],
                ['Today', signed(dayPnl), dir(dayPnl)],
                ['Portfolio weight', share(row.weight), ''],
              ] as const).map(([k, v, cls], i) => (
                <motion.div key={k} className="li" style={{ minHeight: 44 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...enter, delay: staggerDelay(i) }}>
                  <span className="m2">{k}</span><span className={`b ${cls}`}>{v}</span>
                </motion.div>
              ))}
            </>
          ) : (
            <div className="state" style={{ minHeight: 120 }}>You don’t hold {displaySymbol(symbol)} in any linked account.</div>
          )}
        </section>

        {row && (
          <section className="card">
            <div className="ch"><h3>By account</h3></div>
            {row.children.map((c, i) => {
              const a = get(c.accountIds[0])
              return (
                <motion.div key={c.key} className="li" {...rowIn(i)}>
                  <span className="two">
                    <span className="b">{a ? a.account_type : `Account ${c.accountIds[0]}`}</span>
                    <span className="m small">{qty(c.quantity)} shares · avg {num(c.averageCost)}{a ? ` · ${a.institution}` : ''}</span>
                  </span>
                  <span className="b">{num(c.marketValue)}</span>
                </motion.div>
              )
            })}
          </section>
        )}
      </aside>
    </div>
  )
}
