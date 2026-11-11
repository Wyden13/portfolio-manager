import { motion } from 'motion/react'
import { useMemo, useState, type CSSProperties } from 'react'
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
import { dir, num, qty, share, signed, signedPct } from '../lib/format'
import { csvName, downloadCsv, holdingRows, sortRows, toCsv, type Profiles } from '../lib/holdings'
import { rowIn, staggerDelay, enter } from '../lib/motion'
import { accountDayChange, displaySymbol, exposure, portfolioDayChange, SERIES_VARS } from '../lib/portfolio'
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

function ValuePanel({ snapshot, history }: { snapshot: PortfolioSnapshot; history: PnLHistory }) {
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
  const first = points[0]?.v
  const last = points.at(-1)?.v
  const change = first !== undefined && last !== undefined ? last - first : null
  const changePct = change !== null && first ? (change / first) * 100 : null

  return (
    <section className="p c8">
      <div className="ph">
        <h2>Market value</h2>
        <RangeGroup label="Chart range" value={range} options={RANGES} onChange={setRange} />
      </div>
      <div className="stats">
        {[
          <><span className="lab">Market value</span><FlashValue value={total}><span className="val">{num(total)}</span></FlashValue></>,
          <><span className="lab">Day change</span><span className={`val ${dir(day.amount)}`}>{signed(day.amount)}</span><span className={dir(day.amount)} style={{ fontSize: 12 }}>{signedPct(day.pct)}</span></>,
          <><span className="lab">Unrealized P/L</span><span className={`val ${dir(base?.unrealized_pnl)}`}>{signed(base?.unrealized_pnl)}</span><span className={dir(base?.unrealized_pnl)} style={{ fontSize: 12 }}>{signedPct(base?.unrealized_pct)}</span></>,
          <><span className="lab">Book cost</span><span className="val">{num(base?.cost_basis)}</span></>,
        ].map((cell, i) => (
          // Stats settle one after another (30ms apart) once the numbers are in.
          <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...enter, delay: staggerDelay(i) }}>{cell}</motion.div>
        ))}
      </div>
      <div className="chart-body">
        <div className="chart-meta">
          <span className="m">{RANGE_LABEL[range]}</span>
          <span className={dir(change)} style={{ fontWeight: 600 }}>
            {change === null ? '' : `${signed(change)} (${signedPct(changePct)})`}
          </span>
        </div>
        {points.length >= 2 ? (
          <AreaChart points={points} height={248} tone={change !== null && change < 0 ? 'dn' : 'up'} label="Market value over the selected range"
            formatTime={TICK[range]} formatTip={TIP[range]} reference={first !== undefined ? { value: first, kind: 'base' } : undefined}
            seriesKey={range} digits={2} ticks={range === '1Y' ? 7 : 6} />
        ) : (
          <div className="state" style={{ minHeight: 280 }} role="status">
            {state.status === 'error' ? 'Couldn’t load the value history.'
              : range === '1D' ? 'Today’s line builds up from live updates while this page is open.'
              : 'Loading…'}
          </div>
        )}
        {range === '1D' && points.length >= 2 && <span className="m" style={{ fontSize: 11 }}>From live updates since {clock(points[0].t)}.</span>}
      </div>
    </section>
  )
}

function AllocationPanel({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const { label, get } = useAccounts()
  // Classes by size, cash last: it takes the lightest swatch, as on the design.
  const slices = allocation(snapshot, 'class', label).sort((a, b) => Number(a.name === CASH_LABEL) - Number(b.name === CASH_LABEL))
  const sum = slices.reduce((a, s) => a + s.value, 0)
  const exp = exposure(snapshot, (id) => get(id)?.account_type)
  const pct = (v: number) => (exp.total ? (v / exp.total) * 100 : null)
  return (
    <section className="p c4">
      <div className="ph"><h2>Allocation</h2><span className="m" style={{ fontSize: 12 }}>By asset class</span></div>
      <div style={{ padding: '16px 12px' }}>
        <div className="strip" role="img" aria-label="Allocation by asset class">
          {slices.map((s, i) => (
            <motion.span key={s.name} style={{ background: SERIES_VARS[i % SERIES_VARS.length], width: `${(s.value / sum) * 100}%`, transformOrigin: 'left' }}
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />
          ))}
        </div>
      </div>
      <div className="tb" style={{ ...cols('minmax(0, 1fr) 96px 72px'), borderTop: '1px solid var(--line)' }}>
        <div className="tr th"><span>Class</span><span>Value</span><span>Weight</span></div>
        {slices.map((s, i) => (
          <motion.div key={s.name} className="tr" {...rowIn(i)}>
            <span><span className="sw" style={{ background: SERIES_VARS[i % SERIES_VARS.length] }} />{s.name}</span>
            <span>{num(s.value)}</span><span>{share((s.value / sum) * 100)}</span>
          </motion.div>
        ))}
      </div>
      <div className="ph top"><h2>Exposure</h2></div>
      <div className="tb" style={cols('minmax(0, 1fr) 96px 72px')}>
        <div className="tr"><span>Tax-sheltered · TFSA, RRSP, FHSA</span><span>{num(exp.sheltered)}</span><span>{share(pct(exp.sheltered))}</span></div>
        <div className="tr"><span>Taxable · Non-registered</span><span>{num(exp.taxable)}</span><span>{share(pct(exp.taxable))}</span></div>
        <div className="tr"><span>USD-denominated</span><span>{num(exp.usd)}</span><span>{share(pct(exp.usd))}</span></div>
      </div>
    </section>
  )
}

function HoldingsPanel({ snapshot, profiles }: { snapshot: PortfolioSnapshot; profiles: Profiles }) {
  const all = useMemo(() => sortRows(holdingRows(snapshot, profiles), 'marketValue', 'desc', snapshot.fx_rates), [snapshot, profiles])
  const base = snapshot.base_currency
  return (
    <section className="p c8">
      <div className="ph"><h2>Holdings</h2><a href={hashFor('holdings')}>All {all.length} positions</a></div>
      <div className="sx">
        <div className="tb" style={{ ...cols('72px minmax(180px, 1fr) 84px 80px 72px 104px 96px 72px'), minWidth: 760 }}>
          <div className="tr th"><span>Symbol</span><span className="L">Name</span><span>Qty</span><span>Price</span><span>Day</span><span>Mkt value</span><span>Unrealized</span><span>Weight</span></div>
          {all.slice(0, 10).map((h, i) => (
            <motion.div key={h.key} className="tr hv" {...rowIn(i)}>
              {/* The ticker carries over into the holding page's title. */}
              <span><a href={holdingHash(h.symbol)} className="sym"><motion.span layoutId={`sym-${h.symbol}`} style={{ display: 'inline-block' }}>{displaySymbol(h.symbol)}</motion.span></a></span>
              <span className="L" style={{ color: 'var(--ink2)' }}>{h.profile?.name ?? '—'}{base && h.currency !== base ? ` · ${h.currency}` : ''}</span>
              <span>{qty(h.quantity)}</span>
              <span>{num(h.price)}</span>
              <span className={dir(h.dayChangePct)}>{signedPct(h.dayChangePct)}</span>
              <span>{num(h.marketValue)}</span>
              <span className={dir(h.pnlPct)}>{signedPct(h.pnlPct, 1)}</span>
              <span>{share(h.weight)}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function AccountsPanel({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const { get } = useAccounts()
  const rows = [...snapshot.accounts].sort((a, b) => b.total - a.total)
  const day = portfolioDayChange(snapshot)
  return (
    <section className="p c4">
      <div className="ph"><h2>Accounts</h2><a href={hashFor('accounts')}>Details</a></div>
      <div className="tb" style={cols('minmax(0, 1fr) 100px 76px')}>
        <div className="tr th"><span>Account</span><span>Value</span><span>Day</span></div>
        {rows.map((a, i) => {
          const acct = get(a.account_id)
          const d = accountDayChange(snapshot, a.account_id)
          return (
            <motion.div key={a.account_id} className="tr hv" {...rowIn(i)}>
              <span>
                <a href={hashFor('accounts', { account: String(a.account_id) })} className="hl" style={{ fontWeight: 500 }}>{acct?.account_type || `Account ${a.account_id}`}</a>
                {acct && <span className="m"> · {acct.institution}</span>}
              </span>
              <span>{num(a.total)}</span>
              <span className={dir(d.pct)}>{signedPct(d.pct)}</span>
            </motion.div>
          )
        })}
        <div className="tr tot"><span>Total</span><span>{num(snapshot.total_assets_base)}</span><span className={dir(day.pct)}>{signedPct(day.pct)}</span></div>
      </div>
      <div className="ph top"><RoomHeading /></div>
      <ContributionRoom columns="short" />
    </section>
  )
}

export function Portfolio({ snapshot, history, profiles, stream }: {
  snapshot: PortfolioSnapshot; history: PnLHistory; profiles: Profiles; stream: StreamState
}) {
  const { label } = useAccounts()
  const [exportRef, pulse] = usePulse<HTMLButtonElement>()
  if (snapshot.accounts.length === 0 && snapshot.positions.length === 0) return <NoAccounts />

  const positions = new Set(snapshot.positions.map((p) => `${p.symbol}|${p.currency}`)).size
  const base = snapshot.base_currency ?? ''
  const exportCsv = () => {
    const rows = sortRows(holdingRows(snapshot, profiles), 'marketValue', 'desc', snapshot.fx_rates)
    downloadCsv(toCsv(rows, base, label), csvName('holdings'))
    pulse()
  }
  const unpriced = snapshot.positions.filter((p) => p.status === 'no_quote' || p.status === 'currency_mismatch').length

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <h1>Portfolio</h1>
          <span className="m">
            {snapshot.accounts.length} accounts · {positions} positions · {base} · as of {clock(snapshot.as_of)}, {shortDay(snapshot.as_of)} ·{' '}
            <span className={`live ${stream === 'open' ? 'on' : 'off'}`}><span className="live-dot" />{stream === 'open' ? 'Live' : stream === 'reconnecting' ? 'Reconnecting' : 'Paused'}</span>
          </span>
        </div>
        <div className="actions">
          <button type="button" className="btn o" ref={exportRef} onClick={exportCsv}><Icon name="download" />Export CSV</button>
          <a href={hashFor('accounts')} className="btn o">Manage accounts</a>
        </div>
      </div>
      {unpriced > 0 && (
        <p className="banner" role="status">
          {unpriced} {unpriced === 1 ? 'holding has' : 'holdings have'} no live price right now and {unpriced === 1 ? 'is' : 'are'} left out of the totals.
        </p>
      )}
      <div className="grid">
          <ValuePanel snapshot={snapshot} history={history} />
          <AllocationPanel snapshot={snapshot} />
          <HoldingsPanel snapshot={snapshot} profiles={profiles} />
          <AccountsPanel snapshot={snapshot} />
          <section className="p c8">
            <div className="ph"><h2>News on your holdings <SampleTag what="News" /></h2><a href={hashFor('news')}>All news</a></div>
            <NewsRows stories={storiesFor(snapshot).filter((s) => s.daysAgo <= 1).slice(0, 5)} snapshot={snapshot} />
          </section>
          <section className="p c4">
            <div className="ph"><h2>Upcoming <SampleTag what="The calendar" /></h2></div>
            <Upcoming snapshot={snapshot} limit={4} />
          </section>
      </div>
    </>
  )
}
