import { motion } from 'motion/react'
import { useMemo, useState, type CSSProperties, type Ref } from 'react'
import { fetchAccountValueHistory } from '../api/client'
import { AreaChart, type Point } from '../components/AreaChart'
import { Icon } from '../components/Icon'
import { NoAccounts } from '../components/LiveGate'
import { ContributionRoom, NewsRows, RoomHeading, Upcoming } from '../components/SamplePanels'
import { FlashValue } from '../components/ui/FlashValue'
import { RangeGroup } from '../components/ui/RangeGroup'
import { SampleTag } from '../components/ui/SampleTag'
import { useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { TOTAL_KEY, type PnLHistory, type StreamState } from '../hooks/useLivePortfolio'
import { usePulse } from '../hooks/usePulse'
import { allocation, CASH_LABEL } from '../lib/aggregate'
import { clock, longDay, month, monthYear, shortDay, year } from '../lib/dates'
import { dir, dollars, num, plural, qty, share, signedDollars, signedPct } from '../lib/format'
import { csvName, downloadCsv, holdingRows, sortRows, toCsv, type Profiles } from '../lib/holdings'
import { enter, rowIn, staggerDelay } from '../lib/motion'
import { accountDayChange, displaySymbol, portfolioDayChange, SERIES_VARS } from '../lib/portfolio'
import { storiesFor } from '../lib/samples'
import { hashFor, holdingHash } from '../lib/route'
import type { HistoryRange, PortfolioSnapshot } from '../types'

const RANGES = ['1D', '5D', '1M', '3M', '1Y', 'All'] as const
type Range = typeof RANGES[number]

/** Which stored series each range reads: 1D is this session's live samples, 5D the tail of a month. */
const API_RANGE: Record<Range, HistoryRange | null> = { '1D': null, '5D': '1M', '1M': '1M', '3M': '3M', '1Y': '1Y', All: 'ALL' }
const RANGE_LABEL: Record<Range, string> = { '1D': 'Today', '5D': 'Past 5 days', '1M': 'Past month', '3M': 'Past 3 months', '1Y': 'Past year', All: 'Since first activity' }
const TICK: Record<Range, (t: number) => string> = { '1D': clock, '5D': shortDay, '1M': shortDay, '3M': shortDay, '1Y': month, All: year }
const TIP: Record<Range, (t: number) => string> = { '1D': clock, '5D': longDay, '1M': longDay, '3M': longDay, '1Y': longDay, All: monthYear }

const cols = (c: string) => ({ '--cols': c }) as CSSProperties

function ValueSection({ snapshot, history, stream, onExport, exportRef }: {
  snapshot: PortfolioSnapshot; history: PnLHistory; stream: StreamState; onExport: () => void; exportRef: Ref<HTMLButtonElement>
}) {
  const [range, setRange] = useState<Range>('1Y')
  const api = API_RANGE[range]
  const state = useAsync(`value:${api ?? 'live'}`, (signal) => (api ? fetchAccountValueHistory(api, signal) : Promise.resolve(null)))
  const live = history[TOTAL_KEY]

  const points: Point[] = useMemo(() => {
    if (range === '1D') return (live ?? []).map((s) => ({ t: s.t / 1000, v: s.value }))
    if (state.status !== 'ready' || !state.data) return []
    const total = state.data.total.map((p) => ({ t: p.time, v: p.value }))
    return range === '5D' ? total.slice(-5) : total
  }, [range, live, state])

  const total = snapshot.total_assets_base
  const day = portfolioDayChange(snapshot)
  const base = snapshot.base_total
  const cash = snapshot.cash_base
  const positions = new Set(snapshot.positions.map((p) => `${p.symbol}|${p.currency}`)).size
  const first = points[0]?.v
  const last = points.at(-1)?.v
  const change = first !== undefined && last !== undefined ? last - first : null
  const changePct = change !== null && first ? (change / first) * 100 : null

  const kpis = [
    <><span className="lab">Day change</span><span className={`kv ${dir(day.amount)}`}>{signedDollars(day.amount)}</span><span className={`small ${dir(day.amount)}`}>{signedPct(day.pct)}</span></>,
    <><span className="lab">Unrealized P/L</span><span className={`kv ${dir(base?.unrealized_pnl)}`}>{signedDollars(base?.unrealized_pnl)}</span><span className={`small ${dir(base?.unrealized_pnl)}`}>{signedPct(base?.unrealized_pct)}</span></>,
    <><span className="lab">Book cost</span><span className="kv">{dollars(base?.cost_basis)}</span><span className="m small">{plural(positions, 'position', 'positions')}</span></>,
    <><span className="lab">Cash</span><span className="kv">{dollars(cash)}</span><span className="m small">{share(total && cash !== null ? (cash / total) * 100 : null)} of portfolio</span></>,
  ]

  return (
    <section className="stack">
      <div className="page-head">
        <div className="page-title">
          <span className="lab">Total portfolio value · {plural(snapshot.accounts.length, 'account', 'accounts')}{snapshot.base_currency ? ` · ${snapshot.base_currency}` : ''}</span>
          <FlashValue value={total}><span className="big">{dollars(total)}</span></FlashValue>
          <span>
            <span className={`b ${dir(change)}`}>{change === null ? '' : `${signedDollars(change)} (${signedPct(changePct)})`}</span>{' '}
            <span className="m">{RANGE_LABEL[range]}</span>
          </span>
        </div>
        <button type="button" className="btn o s" ref={exportRef} onClick={onExport}><Icon name="download" />Export CSV</button>
      </div>
      {points.length >= 2 ? (
        <AreaChart points={points} height={280} tone={change !== null && change < 0 ? 'dn' : 'up'} label="Portfolio value over the selected range"
          formatTime={TICK[range]} formatTip={TIP[range]} reference={first !== undefined ? { value: first, kind: 'base' } : undefined}
          seriesKey={range} digits={2} ticks={range === '1Y' ? 7 : 6} />
      ) : (
        <div className="state" style={{ minHeight: 300 }} role="status">
          {state.status === 'error' ? 'Couldn’t load the value history.'
            : range === '1D' ? 'Today’s line builds up from live updates while this page is open.'
            : 'Loading…'}
        </div>
      )}
      <div className="chart-foot">
        <RangeGroup label="Chart range" value={range} options={RANGES} onChange={setRange} />
        <span className="m small">
          <span className={`live ${stream === 'open' ? 'on' : 'off'}`} style={{ marginRight: 10 }}>
            <span className="live-dot" />{stream === 'open' ? 'Live' : stream === 'reconnecting' ? 'Reconnecting' : 'Paused'}
          </span>
          As of {clock(snapshot.as_of)}, {shortDay(snapshot.as_of)}
        </span>
      </div>
      <div className="kpis">
        {kpis.map((cell, i) => (
          // KPIs settle one after another (30ms apart) once the numbers are in.
          <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, delay: staggerDelay(i) }}>{cell}</motion.div>
        ))}
      </div>
    </section>
  )
}

function HoldingsSection({ snapshot, profiles }: { snapshot: PortfolioSnapshot; profiles: Profiles }) {
  const all = useMemo(() => sortRows(holdingRows(snapshot, profiles), 'marketValue', 'desc', snapshot.fx_rates), [snapshot, profiles])
  const base = snapshot.base_currency
  return (
    <section>
      <div className="sh"><h2>Holdings</h2><a href={hashFor('holdings')} className="lk">All {all.length} positions</a></div>
      <div className="sx">
        <div className="tb tbA" style={{ ...cols('minmax(200px, 1fr) 64px 80px 76px 112px 92px 60px'), minWidth: 760 }}>
          <div className="tr th"><span>Symbol</span><span>Shares</span><span>Price</span><span>Today</span><span>Market value</span><span>Unrealized</span><span>Weight</span></div>
          {all.slice(0, 10).map((h, i) => (
            <motion.a key={h.key} href={holdingHash(h.symbol)} className="tr hv" {...rowIn(i)}>
              <span className="two">
                {/* The ticker carries over into the holding page's title. */}
                <span className="sym"><motion.span layoutId={`sym-${h.symbol}`} style={{ display: 'inline-block' }}>{displaySymbol(h.symbol)}</motion.span></span>
                <span className="m small">{h.profile?.name ?? '—'}{base && h.currency !== base ? ` · ${h.currency}` : ''}</span>
              </span>
              <span>{qty(h.quantity)}</span>
              <span>{num(h.price)}</span>
              <span className={dir(h.dayChangePct)}>{signedPct(h.dayChangePct)}</span>
              <span className="b">{num(h.marketValue)}</span>
              <span className={dir(h.pnlPct)}>{signedPct(h.pnlPct, 1)}</span>
              <span className="m2">{share(h.weight)}</span>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  )
}

function AccountsCard({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const { get } = useAccounts()
  const rows = [...snapshot.accounts].sort((a, b) => b.total - a.total)
  return (
    <section className="card">
      <div className="ch"><h3>Accounts</h3><a href={hashFor('accounts')}>Manage</a></div>
      {rows.map((a, i) => {
        const acct = get(a.account_id)
        const d = accountDayChange(snapshot, a.account_id)
        return (
          <motion.a key={a.account_id} href={hashFor('accounts', { account: String(a.account_id) })} className="li" {...rowIn(i)}>
            <span className="two"><span className="b">{acct?.account_type || `Account ${a.account_id}`}</span><span className="m small">{acct?.institution ?? ''}</span></span>
            <span className="two" style={{ textAlign: 'right' }}><span className="b">{dollars(a.total)}</span><span className={`small ${dir(d.pct)}`}>{signedPct(d.pct)} today</span></span>
          </motion.a>
        )
      })}
      <div className="li tot"><span>Total</span><span>{dollars(snapshot.total_assets_base)}</span></div>
    </section>
  )
}

function AllocationCard({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const { label } = useAccounts()
  // Classes by size, cash last: it takes the lightest swatch, as on the design.
  const slices = allocation(snapshot, 'class', label).sort((a, b) => Number(a.name === CASH_LABEL) - Number(b.name === CASH_LABEL))
  const sum = slices.reduce((a, s) => a + s.value, 0)
  return (
    <section className="card">
      <div className="ch"><h3>Allocation</h3><span className="m small">By asset class</span></div>
      <div className="card-pad">
        <div className="strip" role="img" aria-label="Allocation by asset class">
          {slices.map((s, i) => (
            <motion.span key={s.name} style={{ background: SERIES_VARS[i % SERIES_VARS.length], width: `${(s.value / sum) * 100}%`, transformOrigin: 'left' }}
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />
          ))}
        </div>
      </div>
      {slices.map((s, i) => (
        <motion.div key={s.name} className="li" style={{ ...cols('minmax(0, 1fr) 96px 48px'), minHeight: 40 }} {...rowIn(i)}>
          <span><span className="sw" style={{ background: SERIES_VARS[i % SERIES_VARS.length] }} />{s.name}</span>
          <span className="m2">{num(s.value)}</span>
          <span className="b">{share((s.value / sum) * 100)}</span>
        </motion.div>
      ))}
    </section>
  )
}

export function Portfolio({ snapshot, history, profiles, stream }: {
  snapshot: PortfolioSnapshot; history: PnLHistory; profiles: Profiles; stream: StreamState
}) {
  const { label } = useAccounts()
  const [exportRef, pulse] = usePulse<HTMLButtonElement>()
  if (snapshot.accounts.length === 0 && snapshot.positions.length === 0) return <NoAccounts />

  const exportCsv = () => {
    const rows = sortRows(holdingRows(snapshot, profiles), 'marketValue', 'desc', snapshot.fx_rates)
    downloadCsv(toCsv(rows, snapshot.base_currency ?? '', label), csvName('holdings'))
    pulse()
  }
  const unpriced = snapshot.positions.filter((p) => p.status === 'no_quote' || p.status === 'currency_mismatch').length

  return (
    <>
      {unpriced > 0 && (
        <p className="banner" role="status">
          {unpriced} {unpriced === 1 ? 'holding has' : 'holdings have'} no live price right now and {unpriced === 1 ? 'is' : 'are'} left out of the totals.
        </p>
      )}
      <div className="layout">
        <div className="main">
          <ValueSection snapshot={snapshot} history={history} stream={stream} onExport={exportCsv} exportRef={exportRef} />
          <HoldingsSection snapshot={snapshot} profiles={profiles} />
          <section>
            <div className="sh"><h2>News on your holdings <SampleTag what="News" /></h2><a href={hashFor('news')} className="lk">All news</a></div>
            <NewsRows stories={storiesFor(snapshot).filter((s) => s.daysAgo <= 1).slice(0, 5)} snapshot={snapshot} />
          </section>
        </div>
        <aside className="rail">
          <AccountsCard snapshot={snapshot} />
          <AllocationCard snapshot={snapshot} />
          <section className="card">
            <div className="ch"><RoomHeading /></div>
            <ContributionRoom variant="list" />
          </section>
          <section className="card">
            <div className="ch"><h3>Upcoming <SampleTag what="The calendar" /></h3></div>
            <Upcoming snapshot={snapshot} limit={4} />
          </section>
        </aside>
      </div>
    </>
  )
}
