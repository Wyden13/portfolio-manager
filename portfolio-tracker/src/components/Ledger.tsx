import { useEffect, useMemo, useState } from 'react'
import { fetchLedger, ledgerCsvUrl, type LedgerQuery } from '../api/client'
import { accountName, useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { money } from '../lib/format'
import type { LedgerEntry, LedgerPage, TransactionKind } from '../types'
import { Empty, Panel } from './Panel'

const PAGE_SIZE = 50
const SYMBOL_DEBOUNCE_MS = 300
const KINDS: readonly TransactionKind[] = ['BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'OTHER']
const KIND_LABEL: Record<TransactionKind, string> = {
  BUY: 'Buy', SELL: 'Sell', DIVIDEND: 'Dividend', DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', FEE: 'Fee', OTHER: 'Other',
}

const EMPTY_FILTERS: LedgerQuery = { kinds: [] }

/** Trade dates are stored as naive UTC; show the calendar day without shifting it into local time. */
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const tradeDay = (iso: string) => dateFormat.format(new Date(`${iso}Z`))

const quantityFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 })

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return debounced
}

function Row({ t }: { t: LedgerEntry }) {
  const traded = t.kind === 'BUY' || t.kind === 'SELL'
  return (
    <tr>
      <td className="c-date nowrap">{tradeDay(t.trade_date)}</td>
      <td className="c-account">
        <span className="account-name">{t.institution}</span>
        <span className="muted small nowrap">{t.account_type} {t.account_number}</span>
      </td>
      <td className="c-type"><span className={`pill kind-${t.kind.toLowerCase()}`}>{KIND_LABEL[t.kind]}</span></td>
      <td className="c-symbol nowrap">{t.symbol ?? '—'}</td>
      <td className="c-qty num">{t.quantity ? quantityFormat.format(t.quantity) : '—'}</td>
      <td className="c-price num">{traded ? money(t.price, t.currency) : '—'}</td>
      <td className="c-fee num">{t.fee ? money(t.fee, t.currency) : '—'}</td>
      <td className={`c-amount num strong ${t.net_amount > 0 ? 'gain' : t.net_amount < 0 ? 'loss' : ''}`}>
        {t.net_amount ? money(t.net_amount, t.currency) : '—'}
      </td>
      <td className="c-desc description" title={t.description}>{t.description}</td>
    </tr>
  )
}

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
  const clear = () => {
    setFilters(EMPTY_FILTERS)
    setSymbolInput('')
  }

  const first = data && data.total ? data.offset + 1 : 0
  const last = data ? data.offset + data.items.length : 0

  return (
    <Panel
      title="Ledger"
      controls={
        <a className="btn" href={ledgerCsvUrl(query)} download>
          Export CSV
        </a>
      }
    >
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter transactions">
        <label className="field">
          <span>Institution</span>
          <select
            value={filters.institution ?? ''}
            onChange={(e) => update({ institution: e.target.value || undefined, accountId: undefined })}
          >
            <option value="">All institutions</option>
            {institutions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Account</span>
          <select
            value={filters.accountId ?? ''}
            onChange={(e) => update({ accountId: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">All accounts</option>
            {accountChoices.map((a) => <option key={a.id} value={a.id}>{accountName(a)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Symbol</span>
          <input type="search" placeholder="e.g. RY.TO" value={symbolInput} onChange={(e) => setSymbolInput(e.target.value)} />
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={filters.start ?? ''} max={filters.end} onChange={(e) => update({ start: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={filters.end ?? ''} min={filters.start} onChange={(e) => update({ end: e.target.value || undefined })} />
        </label>
        <div className="chips" role="group" aria-label="Transaction type">
          {KINDS.map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={filters.kinds.includes(k)} onClick={() => toggleKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
          {filtered && <button type="button" className="link-btn" onClick={clear}>Clear filters</button>}
        </div>
      </form>

      {state.status === 'error' && !data ? (
        <Empty tone="error">
          Couldn’t load transactions.
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </Empty>
      ) : !data ? (
        <Empty height={320}>Loading transactions…</Empty>
      ) : data.total === 0 ? (
        <Empty height={320}>
          {filtered ? 'No transactions match these filters.' : 'No transactions yet. Sync a brokerage to fill the ledger.'}
          {filtered && <button type="button" className="btn" onClick={clear}>Clear filters</button>}
        </Empty>
      ) : (
        <>
          {state.status === 'error' && (
            <p className="banner warn" role="alert">
              Couldn’t load this page. <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </p>
          )}
          <div className="table-wrap" aria-busy={state.status === 'loading'}>
            <table className={`ledger ${state.status === 'loading' ? 'stale' : ''}`}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Account</th>
                  <th scope="col">Type</th>
                  <th scope="col">Symbol</th>
                  <th scope="col" className="num">Quantity</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col" className="num">Fee</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => <Row key={t.id} t={t} />)}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="Ledger pages">
            <span className="muted small">
              {first.toLocaleString()}–{last.toLocaleString()} of {data.total.toLocaleString()} {data.total === 1 ? 'transaction' : 'transactions'}
            </span>
            <div className="pager-buttons">
              <button type="button" className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button type="button" className="btn" disabled={last >= data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </nav>
        </>
      )}
    </Panel>
  )
}
