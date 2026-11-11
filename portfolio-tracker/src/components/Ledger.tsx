import { motion } from 'motion/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fetchLedger, ledgerCsvUrl, type LedgerQuery } from '../api/client'
import { accountName, useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { tradeDay } from '../lib/dates'
import { dir, num, qty, signed } from '../lib/format'
import { KIND_LABEL, KINDS } from '../lib/kinds'
import { rowIn } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { holdingHash } from '../lib/route'
import type { LedgerEntry, LedgerPage, TransactionKind } from '../types'
import { Icon } from './Icon'

const PAGE_SIZE = 50
const SYMBOL_DEBOUNCE_MS = 300
const EMPTY_FILTERS: LedgerQuery = { kinds: [] }
const GRID = { '--cols': '104px minmax(150px, 1fr) 96px 80px 72px 88px 72px 112px 56px minmax(200px, 1.4fr)', minWidth: 1180 } as CSSProperties

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

function Row({ t, i }: { t: LedgerEntry; i: number }) {
  const traded = t.kind === 'BUY' || t.kind === 'SELL'
  return (
    <motion.div className="tr hv" {...rowIn(i)}>
      <span>{tradeDay(t.trade_date)}</span>
      <span className="L">{t.account_type} <span className="m">{t.account_number} · {t.institution}</span></span>
      <span className="L">{KIND_LABEL[t.kind]}</span>
      <span className="L">{t.symbol ? <a className="sym" href={holdingHash(t.symbol)}>{displaySymbol(t.symbol)}</a> : <span className="m">—</span>}</span>
      <span>{t.quantity ? qty(t.quantity) : '—'}</span>
      <span>{traded ? num(t.price) : '—'}</span>
      <span>{t.fee ? num(t.fee) : '—'}</span>
      <span className={dir(t.net_amount)} style={{ fontWeight: 600 }}>{t.net_amount ? signed(t.net_amount) : '—'}</span>
      <span className="m">{t.currency}</span>
      <span className="L m" title={t.description}>{t.description}</span>
    </motion.div>
  )
}

/** Every stored transaction, filterable and paged, with a CSV of the current filter. */
export function Ledger() {
  const { list: accounts } = useAccounts()
  const [filters, setFilters] = useState<LedgerQuery>(EMPTY_FILTERS)
  const [symbolInput, setSymbolInput] = useState('')
  const symbol = useDebounced(symbolInput, SYMBOL_DEBOUNCE_MS)
  const [page, setPage] = useState(0)
  const [attempt, setAttempt] = useState(0)

  const query = useMemo<LedgerQuery>(() => ({ ...filters, symbol }), [filters, symbol])
  const queryKey = JSON.stringify(query)
  // Any filter change starts again from the first page.
  const [pageFor, setPageFor] = useState(queryKey)
  if (pageFor !== queryKey) {
    setPageFor(queryKey)
    setPage(0)
  }

  const state = useAsync(`${queryKey}|${page}|${attempt}`, (signal) => fetchLedger(query, PAGE_SIZE, page * PAGE_SIZE, signal))
  // While the next page or filter loads, keep showing the previous rows (dimmed) instead of a blank.
  const [shown, setShown] = useState<LedgerPage | null>(null)
  if (state.status === 'ready' && shown !== state.data) setShown(state.data)
  const data = state.status === 'ready' ? state.data : shown

  const institutions = useMemo(() => [...new Set(accounts.map((a) => a.institution))].sort(), [accounts])
  const accountChoices = accounts.filter((a) => !filters.institution || a.institution === filters.institution)
  const filtered = filters.institution || filters.accountId !== undefined || filters.kinds.length > 0 || symbolInput || filters.start || filters.end

  const update = (patch: Partial<LedgerQuery>) => setFilters((f) => ({ ...f, ...patch }))
  const toggleKind = (kind: TransactionKind) =>
    update({ kinds: filters.kinds.includes(kind) ? filters.kinds.filter((k) => k !== kind) : [...filters.kinds, kind] })
  const clear = () => { setFilters(EMPTY_FILTERS); setSymbolInput('') }

  const first = data && data.total ? data.offset + 1 : 0
  const last = data ? data.offset + data.items.length : 0

  return (
    <section className="p">
      <div className="ph">
        <h2>Transactions {data && <span className="m" style={{ fontWeight: 400 }}>{data.total.toLocaleString()} total</span>}</h2>
        <a className="btn o" href={ledgerCsvUrl(query)} download style={{ color: 'var(--ink)' }}><Icon name="download" />Export CSV</a>
      </div>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter transactions">
        <label className="sel">Institution
          <select value={filters.institution ?? ''} onChange={(e) => update({ institution: e.target.value || undefined, accountId: undefined })}>
            <option value="">All institutions</option>
            {institutions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label className="sel">Account
          <select value={filters.accountId ?? ''} onChange={(e) => update({ accountId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All accounts</option>
            {accountChoices.map((a) => <option key={a.id} value={a.id}>{accountName(a)}</option>)}
          </select>
        </label>
        <label className="sel">Symbol
          <input type="search" placeholder="e.g. RY.TO" value={symbolInput} onChange={(e) => setSymbolInput(e.target.value)} />
        </label>
        <label className="sel">From
          <input type="date" value={filters.start ?? ''} max={filters.end} onChange={(e) => update({ start: e.target.value || undefined })} />
        </label>
        <label className="sel">To
          <input type="date" value={filters.end ?? ''} min={filters.start} onChange={(e) => update({ end: e.target.value || undefined })} />
        </label>
        <div className="chips" role="group" aria-label="Transaction type">
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={filters.kinds.includes(k)} onClick={() => toggleKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {filtered && <button type="button" className="btn o" style={{ marginLeft: 'auto' }} onClick={clear}>Reset</button>}
      </form>

      {state.status === 'error' && !data ? (
        <div className="state error" role="alert">
          Couldn’t load transactions.
          <button type="button" className="btn o" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : !data ? (
        <div className="state" role="status" style={{ minHeight: 320 }}>Loading transactions…</div>
      ) : data.total === 0 ? (
        <div className="state" style={{ minHeight: 320 }}>
          {filtered ? 'No transactions match these filters.' : 'No transactions yet. Sync a brokerage to fill the history.'}
          {filtered && <button type="button" className="btn o" onClick={clear}>Reset</button>}
        </div>
      ) : (
        <>
          {state.status === 'error' && (
            <p className="banner warn" role="alert">
              Couldn’t load this page.<button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </p>
          )}
          <div className="sx" aria-busy={state.status === 'loading'}>
            <div className={`tb ${state.status === 'loading' ? 'stale' : ''}`} style={GRID}>
              <div className="tr th">
                <span>Date</span><span className="L">Account</span><span className="L">Type</span><span className="L">Symbol</span>
                <span>Qty</span><span>Price</span><span>Fee</span><span>Amount</span><span>Ccy</span><span className="L">Description</span>
              </div>
              {data.items.map((t, i) => <Row key={`${page}:${t.id}`} t={t} i={i} />)}
            </div>
          </div>
          <nav className="pager" aria-label="Transaction pages">
            <span className="m">
              {first.toLocaleString()}–{last.toLocaleString()} of {data.total.toLocaleString()} {data.total === 1 ? 'transaction' : 'transactions'}
            </span>
            <div className="actions">
              <button type="button" className="btn o" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button type="button" className="btn o" disabled={last >= data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </nav>
        </>
      )}
    </section>
  )
}
