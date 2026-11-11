import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useMemo, useState, type CSSProperties } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { usePulse } from '../hooks/usePulse'
import { ASSET_CLASS_LABEL } from '../lib/aggregate'
import { abbrev, dir, num, qty, share, signed, signedPct } from '../lib/format'
import {
  csvName, defaultDir, downloadCsv, filterRows, holdingRows, NO_FILTERS, PAGE_SIZES, paginate, sortRows, toCsv,
  type HoldingFilters, type HoldingLine, type PageSize, type Profiles, type SortDir, type SortKey,
} from '../lib/holdings'
import { enter, exit, move, rowIn } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { holdingHash } from '../lib/route'
import type { AssetClass, PortfolioSnapshot } from '../types'
import { Icon } from './Icon'
import { TickerLogo } from './TickerLogo'
import { RangeGroup } from './ui/RangeGroup'

const PAGE_SIZE_KEY = 'investiq.holdings.pageSize'
const ASSET_CLASSES: AssetClass[] = ['stock', 'etf', 'fund', 'other']
const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((s) => (s === 'all' ? 'All' : String(s)))

interface Column { key: SortKey; label: string; left?: boolean; title?: string }

// What it is, how the market has it today, then what you hold.
const COLUMNS: Column[] = [
  { key: 'symbol', label: 'Ticker', left: true },
  { key: 'name', label: 'Company', left: true },
  { key: 'sector', label: 'Sector', left: true },
  { key: 'marketCap', label: 'Mkt cap' },
  { key: 'pe', label: 'P/E', title: 'Trailing price / earnings' },
  { key: 'price', label: 'Price' },
  { key: 'dayChange', label: 'Day', title: 'Since the last session’s close' },
  { key: 'volume', label: 'Volume', title: 'Shares traded this session' },
  { key: 'quantity', label: 'Qty' },
  { key: 'averageCost', label: 'Avg cost' },
  { key: 'marketValue', label: 'Mkt value' },
  { key: 'pnl', label: 'Unrl. $' },
  { key: 'pnlPct', label: 'Unrl. %' },
  { key: 'weight', label: 'Weight', title: 'Share of total assets, cash included' },
]
const GRID = { '--cols': '44px 104px minmax(180px, 1fr) 120px 80px 64px 80px 72px 72px 72px 80px 104px 96px 72px 64px 120px', minWidth: 1460 } as CSSProperties

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

/** Quantity through weight, shared by a row and its per-account lines. */
function PositionCells({ line }: { line: HoldingLine }) {
  return (
    <>
      <span>{qty(line.quantity)}</span>
      <span>{num(line.averageCost)}</span>
      <span>{num(line.marketValue)}</span>
      <span className={dir(line.pnl)}>{signed(line.pnl)}</span>
      <span className={dir(line.pnlPct)}>{signedPct(line.pnlPct, 1)}</span>
      <span>{share(line.weight)}</span>
    </>
  )
}

/** Every holding, summed across accounts: sort, filter, page, expand per account, export. */
export function HoldingsTable({ snapshot, profiles }: { snapshot: PortfolioSnapshot; profiles: Profiles }) {
  const { list: accounts, label, get } = useAccounts()
  const base = snapshot.base_currency ?? snapshot.base_total?.currency ?? 'CAD'
  const [accountId, setAccountId] = useState<number | undefined>()
  const [filters, setFilters] = useState<HoldingFilters>(NO_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'marketValue', dir: 'desc' })
  const [pageSize, setPageSize] = useState<PageSize>(readPageSize)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [exportRef, pulse] = usePulse<HTMLButtonElement>()

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

  const update = (patch: Partial<HoldingFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const clear = () => { setFilters(NO_FILTERS); setAccountId(undefined) }
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) }))
  const toggle = (key: string) => setExpanded((s) => {
    const next = new Set(s)
    if (!next.delete(key)) next.add(key)
    return next
  })
  const exportCsv = () => {
    downloadCsv(toCsv(rows, base, label), csvName('holdings'))
    pulse()
  }
  const short = (id: number) => { const a = get(id); return a ? `${a.account_type} · ${a.institution}` : `Account ${id}` }
  const first = shown.page * (pageSize === 'all' ? 0 : pageSize)

  return (
    <section className="stack">
      <div className="sh" style={{ alignItems: 'center' }}>
        <h2>All holdings <span className="m" style={{ fontWeight: 400 }}>{rows.length} of {all.length} · values in each listing’s currency</span></h2>
        <div className="actions">
          <RangeGroup label="Rows per page" value={pageSize === 'all' ? 'All' : String(pageSize)} options={PAGE_SIZE_OPTIONS}
            onChange={(s) => { const size = s === 'All' ? 'all' : Number(s) as PageSize; setPageSize(size); storePageSize(size) }} />
          <button type="button" className="btn o s" ref={exportRef} onClick={exportCsv} disabled={rows.length === 0}><Icon name="download" />Export CSV</button>
        </div>
      </div>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter holdings">
        <label className="sel">Search
          <input type="search" placeholder="Ticker or company" value={filters.query} onChange={(e) => update({ query: e.target.value })} />
        </label>
        <label className="sel">Account
          <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">All accounts</option>
            {accounts.filter((a) => !a.removed).map((a) => <option key={a.id} value={a.id}>{label(a.id)}</option>)}
          </select>
        </label>
        <label className="sel">Sector
          <select value={filters.sector} onChange={(e) => update({ sector: e.target.value })}>
            <option value="">Any</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="sel">Asset class
          <select value={filters.assetClass} onChange={(e) => update({ assetClass: e.target.value as AssetClass | '' })}>
            <option value="">Any</option>
            {classes.map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
          </select>
        </label>
        {currencies.length > 1 && (
          <label className="sel">Currency
            <select value={filters.currency} onChange={(e) => update({ currency: e.target.value })}>
              <option value="">Any</option>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {filtered && <button type="button" className="btn o s" style={{ marginLeft: 'auto' }} onClick={clear}>Reset</button>}
      </form>

      {rows.length === 0 ? (
        <div className="state">No holdings match these filters. <button type="button" className="btn o s" onClick={clear}>Reset</button></div>
      ) : (
        <div className="sx">
          <div className="tb" style={GRID}>
            <div className="tr th">
              <span>No.</span>
              {COLUMNS.map((c) => (
                <span key={c.key} className={c.left ? 'L' : ''}>
                  <button type="button" title={c.title} onClick={() => sortBy(c.key)}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </span>
              ))}
              <span className="L">Accounts</span>
            </div>
            {shown.rows.map((r, i) => {
              const p = r.profile
              const open = expanded.has(r.key)
              return (
                <Fragment key={r.key}>
                  {/* Re-sorting slides rows to their new places (ease-in-out). */}
                  <motion.div className="tr hv" layout="position" transition={{ layout: move, ...enter, delay: rowIn(i).transition.delay }}
                    initial={rowIn(i).initial} animate={rowIn(i).animate}>
                    <span className="m">{first + i + 1}</span>
                    <span className="sym-cell"><TickerLogo symbol={r.symbol} website={p?.website} /><a href={holdingHash(r.symbol)} className="sym">{displaySymbol(r.symbol)}</a></span>
                    <span className="L" style={{ color: 'var(--ink2)' }} title={p?.name ?? undefined}>{p?.name ?? '—'}</span>
                    <span className="L m">{p?.sector ?? '—'}</span>
                    <span>{abbrev(p?.market_cap)}</span>
                    <span>{num(p?.pe, 1)}</span>
                    <span>{num(r.price)}</span>
                    <span className={dir(r.dayChangePct)}>{signedPct(r.dayChangePct)}</span>
                    <span className="m">{abbrev(r.volume)}</span>
                    <PositionCells line={r} />
                    <span className="L">
                      {r.children.length > 1 ? (
                        <button type="button" className="link-btn" aria-expanded={open} onClick={() => toggle(r.key)}>
                          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="inline" /> {r.children.length} accounts
                        </button>
                      ) : <span className="m">{short(r.accountIds[0])}</span>}
                    </span>
                  </motion.div>
                  <AnimatePresence initial={false}>
                    {open && r.children.map((c, k) => (
                      <motion.div key={c.key} className="tr sub" initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0, transition: { ...enter, delay: k * 0.03 } }} exit={{ opacity: 0, transition: exit }}>
                        <span />
                        <span className="L m" style={{ gridColumn: 'span 5' }}>{short(c.accountIds[0])}</span>
                        <span>{num(c.price)}</span>
                        <span /><span />
                        <PositionCells line={c} />
                        <span />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}

      {shown.pages > 1 && (
        <nav className="pager" aria-label="Holdings pages">
          <span className="m">{first + 1}–{first + shown.rows.length} of {rows.length}</span>
          <div className="actions">
            <button type="button" className="btn o s" disabled={shown.page === 0} onClick={() => setPage(shown.page - 1)}>Previous</button>
            <button type="button" className="btn o s" disabled={shown.page >= shown.pages - 1} onClick={() => setPage(shown.page + 1)}>Next</button>
          </div>
        </nav>
      )}
    </section>
  )
}
