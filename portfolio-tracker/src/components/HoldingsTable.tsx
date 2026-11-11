import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { useHashParam } from '../hooks/useHashTab'
import { useProfiles } from '../hooks/useProfiles'
import { ASSET_CLASS_LABEL } from '../lib/aggregate'
import { compactMoney, money, pct, signedMoney, tone } from '../lib/format'
import {
  defaultDir, filterRows, holdingRows, NO_FILTERS, PAGE_SIZES, paginate, sortRows, toCsv,
  type HoldingFilters, type HoldingLine, type HoldingRow, type PageSize, type SortDir, type SortKey,
} from '../lib/holdings'
import { hashFor } from '../lib/route'
import type { Theme } from '../lib/theme'
import type { AssetClass, PortfolioSnapshot, SecurityProfile } from '../types'
import { CandlePanel } from './CandleChart'
import { Empty, Panel, Segmented } from './Panel'
import { TickerLogo } from './TickerLogo'

const PAGE_SIZE_KEY = 'investiq.holdings.pageSize'
const ASSET_CLASSES: AssetClass[] = ['stock', 'etf', 'fund', 'other']
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map(String)
const CURRENCY_MODES = ['native', 'base'] as const
type CurrencyMode = typeof CURRENCY_MODES[number]

interface Column { key: SortKey; label: string; num?: boolean; title?: string }

// Profile columns first (what it is), then market data, then the position itself.
const COLUMNS: Column[] = [
  { key: 'symbol', label: 'Ticker' },
  { key: 'name', label: 'Company' },
  { key: 'sector', label: 'Sector' },
  { key: 'industry', label: 'Industry' },
  { key: 'country', label: 'Country' },
  { key: 'marketCap', label: 'Market cap', num: true },
  { key: 'pe', label: 'P/E', num: true, title: 'Trailing price / earnings' },
  { key: 'price', label: 'Price', num: true },
  { key: 'dayChange', label: 'Change %', num: true, title: 'Since the last session’s close' },
  { key: 'volume', label: 'Volume', num: true, title: 'Shares traded this session' },
  { key: 'quantity', label: 'Qty', num: true },
  { key: 'averageCost', label: 'Avg cost', num: true },
  { key: 'marketValue', label: 'Market value', num: true },
  { key: 'pnl', label: 'Unrealized P&L', num: true },
  { key: 'pnlPct', label: 'P&L %', num: true },
  { key: 'weight', label: 'Weight', num: true, title: 'Share of total assets, cash included' },
]

function readPageSize(): PageSize {
  try {
    const saved = localStorage.getItem(PAGE_SIZE_KEY)
    const size = saved === 'all' ? 'all' : Number(saved)
    return PAGE_SIZES.includes(size as PageSize) ? size as PageSize : 20
  } catch {
    return 20
  }
}

function storePageSize(size: PageSize) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size))
  } catch {
    /* storage can be blocked; the choice just won't be remembered */
  }
}

const quantity = (q: number) => q.toLocaleString(undefined, { maximumFractionDigits: 4 })
const dash = (v: string | null | undefined) => v || '—'

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Market value, P&L and weight cells, shared by a row and its per-account lines. */
function PositionCells({ line, inBase, base }: { line: HoldingLine; inBase: boolean; base: string }) {
  const value = inBase ? line.valueBase : line.marketValue
  const pnl = inBase ? line.pnlBase : line.pnl
  const currency = inBase ? base : line.currency
  return (
    <>
      <td className="num">{quantity(line.quantity)}</td>
      <td className="num">{money(line.averageCost, line.currency)}</td>
      <td className="num strong">{money(value, currency)}</td>
      <td className={`num ${tone(pnl)}`}>{signedMoney(pnl, currency)}</td>
      <td className={`num ${tone(line.pnlPct)}`}>{pct(line.pnlPct)}</td>
      <td className="num">{line.weight === null ? '—' : `${line.weight.toFixed(2)}%`}</td>
    </>
  )
}

interface Props { snapshot: PortfolioSnapshot; theme: Theme }

/** Every holding as a screener-style table: what it is, how the market has it today, what you hold. */
export function HoldingsTable({ snapshot, theme }: Props) {
  const { list: accounts, label } = useAccounts()
  const profiles = useProfiles(snapshot)
  const base = snapshot.base_currency ?? snapshot.base_total?.currency ?? 'CAD'
  const [accountId, setAccountId] = useState<number | undefined>()
  const [filters, setFilters] = useState<HoldingFilters>(NO_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'marketValue', dir: 'desc' })
  const [mode, setMode] = useState<CurrencyMode>('native')
  const [pageSize, setPageSize] = useState<PageSize>(readPageSize)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const open = useHashParam('symbol')

  const all = useMemo(() => holdingRows(snapshot, profiles, accountId), [snapshot, profiles, accountId])
  const rows = useMemo(
    () => sortRows(filterRows(all, filters), sort.key, sort.dir, snapshot.fx_rates),
    [all, filters, sort, snapshot.fx_rates],
  )
  // Any filter, sort or page-size change starts again from the first page.
  const viewKey = JSON.stringify([accountId, filters, sort, pageSize])
  const [pageFor, setPageFor] = useState(viewKey)
  if (pageFor !== viewKey) {
    setPageFor(viewKey)
    setPage(0)
  }
  const shown = paginate(rows, pageSize, page)

  const sectors = useMemo(() => [...new Set(all.map((r) => r.profile?.sector).filter(Boolean) as string[])].sort(), [all])
  const currencies = useMemo(() => [...new Set(all.map((r) => r.currency))].sort(), [all])
  const classes = ASSET_CLASSES.filter((c) => all.some((r) => r.assetClass === c))
  const filtered = accountId !== undefined || JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
  const inBase = mode === 'base'

  const update = (patch: Partial<HoldingFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const clear = () => {
    setFilters(NO_FILTERS)
    setAccountId(undefined)
  }
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) }))
  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const choosePageSize = (size: PageSize) => {
    setPageSize(size)
    storePageSize(size)
  }
  const exportCsv = () =>
    download(toCsv(rows, base, label), `holdings-${new Date().toISOString().slice(0, 10)}.csv`)

  const first = shown.page * (pageSize === 'all' ? 0 : pageSize)
  const openRow = open ? all.find((r) => r.symbol === open) ?? null : null

  if (snapshot.positions.length === 0) {
    return <Empty>No holdings yet. <a href={hashFor('connections')}>Connect a brokerage</a> to see them here.</Empty>
  }
  return (
    <Panel
      title="Holdings"
      controls={<button type="button" className="btn" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>}
    >
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter holdings">
        <label className="field">
          <span>Search</span>
          <input type="search" placeholder="Ticker or company" value={filters.query} onChange={(e) => update({ query: e.target.value })} />
        </label>
        <label className="field">
          <span>Account</span>
          <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All accounts</option>
            {accounts.filter((a) => !a.removed).map((a) => <option key={a.id} value={a.id}>{label(a.id)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Sector</span>
          <select value={filters.sector} onChange={(e) => update({ sector: e.target.value })}>
            <option value="">All sectors</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Asset class</span>
          <select value={filters.assetClass} onChange={(e) => update({ assetClass: e.target.value as AssetClass | '' })}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
          </select>
        </label>
        {currencies.length > 1 && (
          <label className="field">
            <span>Currency</span>
            <select value={filters.currency} onChange={(e) => update({ currency: e.target.value })}>
              <option value="">All currencies</option>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </form>

      <div className="table-toolbar">
        <span className="muted small">
          {rows.length} of {all.length} {all.length === 1 ? 'holding' : 'holdings'}
          {filtered && <> · <button type="button" className="link-btn" onClick={clear}>Clear filters</button></>}
        </span>
        <div className="panel-controls">
          <Segmented label="Show value and P&L in" value={mode} options={CURRENCY_MODES} onChange={setMode}
            format={(m) => (m === 'native' ? 'Native' : base)} />
          <Segmented label="Rows per page" value={String(pageSize)} options={PAGE_SIZE_OPTIONS}
            onChange={(s) => choosePageSize(s === 'all' ? 'all' : Number(s) as PageSize)} format={(s) => (s === 'all' ? 'All' : s)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty height={240}>
          No holdings match these filters.
          <button type="button" className="btn" onClick={clear}>Clear filters</button>
        </Empty>
      ) : (
        <div className="table-wrap holdings-wrap">
          <table className="holdings">
            <thead>
              <tr>
                <th scope="col" className="num c-no">No.</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" className={`${c.num ? 'num' : ''} c-${c.key}`}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="sort" title={c.title} onClick={() => sortBy(c.key)}>
                      {c.label}<span className="sort-arrow" aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                ))}
                <th scope="col">Accounts</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((r, i) => (
                <Fragment key={r.key}>
                  <Row row={r} n={first + i + 1} inBase={inBase} base={base} label={label}
                    expanded={expanded.has(r.key)} onToggle={() => toggle(r.key)} />
                  {expanded.has(r.key) && r.children.map((c) => (
                    <tr key={c.key} className="child">
                      <td className="c-no" />
                      <td className="c-symbol child-account" colSpan={5}>{label(c.accountIds[0])}</td>
                      <td colSpan={2} />
                      <td className="num">{money(c.price, c.currency)}</td>
                      <td colSpan={2} />
                      <PositionCells line={c} inBase={inBase} base={base} />
                      <td />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shown.pages > 1 && (
        <nav className="pager" aria-label="Holdings pages">
          <span className="muted small">
            {first + 1}–{first + shown.rows.length} of {rows.length}
          </span>
          <div className="pager-buttons">
            <button type="button" className="btn" disabled={shown.page === 0} onClick={() => setPage(shown.page - 1)}>Previous</button>
            <button type="button" className="btn" disabled={shown.page >= shown.pages - 1} onClick={() => setPage(shown.page + 1)}>Next</button>
          </div>
        </nav>
      )}

      <HoldingDrawer symbol={open} row={openRow} base={base} inBase={inBase} theme={theme} />
    </Panel>
  )
}

function Row({ row, n, inBase, base, label, expanded, onToggle }: {
  row: HoldingRow; n: number; inBase: boolean; base: string; label: (id: number) => string
  expanded: boolean; onToggle: () => void
}) {
  const p = row.profile
  const several = row.children.length > 1
  return (
    <tr>
      <td className="num c-no muted">{n}</td>
      <td className="c-symbol">
        <span className="ticker">
          <TickerLogo symbol={row.symbol} website={p?.website} />
          <a href={hashFor('holdings', { symbol: row.symbol })} title={`Price history for ${row.symbol}`}>{row.symbol}</a>
        </span>
      </td>
      <td className="c-name" title={p?.name ?? undefined}>{dash(p?.name)}</td>
      <td>{dash(p?.sector)}</td>
      <td>{dash(p?.industry)}</td>
      <td>{dash(p?.country)}</td>
      <td className="num">{p?.market_cap == null ? '—' : compactMoney(p.market_cap, p.market_cap_currency ?? '')}</td>
      <td className="num">{p?.pe == null ? '—' : p.pe.toFixed(2)}</td>
      <td className={`num ${tone(row.dayChangePct)}`}>{money(row.price, row.currency)}</td>
      <td className={`num ${tone(row.dayChangePct)}`}>{pct(row.dayChangePct)}</td>
      <td className="num">{row.volume === null ? '—' : row.volume.toLocaleString()}</td>
      <PositionCells line={row} inBase={inBase} base={base} />
      <td className="c-accounts">
        {several ? (
          <button type="button" className="link-btn expand" aria-expanded={expanded} onClick={onToggle}>
            <span className="chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            {row.children.length} accounts
          </button>
        ) : label(row.accountIds[0])}
      </td>
    </tr>
  )
}

function ProfileFacts({ profile, row, base, inBase }: {
  profile: SecurityProfile | null; row: HoldingRow | null; base: string; inBase: boolean
}) {
  const facts: Array<[string, ReactNode]> = [
    ['Sector', dash(profile?.sector)],
    ['Industry', dash(profile?.industry)],
    ['Country', dash(profile?.country)],
    ['Market cap', profile?.market_cap == null ? '—' : compactMoney(profile.market_cap, profile.market_cap_currency ?? '')],
    ['P/E', profile?.pe == null ? '—' : profile.pe.toFixed(2)],
  ]
  if (row) {
    facts.push(
      ['Quantity', quantity(row.quantity)],
      ['Market value', inBase ? money(row.valueBase, base) : money(row.marketValue, row.currency)],
      ['Unrealized P&L', <span className={tone(row.pnl)}>{signedMoney(inBase ? row.pnlBase : row.pnl, inBase ? base : row.currency)} {pct(row.pnlPct)}</span>],
    )
  }
  return (
    <dl className="split drawer-facts">
      {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  )
}

/** Side drawer for one ticker, opened through the URL (#/holdings?symbol=...) so Back closes it. */
function HoldingDrawer({ symbol, row, base, inBase, theme }: {
  symbol: string | null; row: HoldingRow | null; base: string; inBase: boolean; theme: Theme
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (symbol && !dialog.open) dialog.showModal()
    if (!symbol && dialog.open) dialog.close()
  }, [symbol])
  const close = () => {
    if (symbol) window.location.hash = hashFor('holdings')
  }
  const profile = row?.profile ?? null

  return (
    <dialog ref={ref} className="dialog drawer" aria-label={symbol ? `${symbol} details` : 'Holding details'}
      onClose={close} onClick={(e) => { if (e.target === ref.current) close() }}>
      {symbol && (
        <>
          <header className="dialog-head">
            <TickerLogo symbol={symbol} website={profile?.website} />
            <h2>
              {symbol}
              {profile?.name && <span className="muted drawer-name">{profile.name}</span>}
            </h2>
            <button type="button" className="icon-btn" onClick={close} aria-label="Close">✕</button>
          </header>
          <ProfileFacts profile={profile} row={row} base={base} inBase={inBase} />
          {profile?.website && (
            <p className="small"><a href={profile.website} target="_blank" rel="noreferrer noopener">{profile.website.replace(/^https?:\/\//, '')}</a></p>
          )}
          <div className="grid drawer-chart">
            <CandlePanel symbols={[symbol]} theme={theme} />
          </div>
        </>
      )}
    </dialog>
  )
}
