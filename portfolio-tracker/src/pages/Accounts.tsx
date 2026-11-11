import { LayoutGroup, motion } from 'motion/react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fetchLedger } from '../api/client'
import { BrokerageLogo } from '../components/BrokerageLogo'
import { Icon } from '../components/Icon'
import { Ledger } from '../components/Ledger'
import { NoAccounts } from '../components/LiveGate'
import { ContributionRoom, RoomHeading } from '../components/SamplePanels'
import { IconSwap } from '../components/ui/IconSwap'
import { Modal } from '../components/ui/Modal'
import { SampleTag } from '../components/ui/SampleTag'
import { useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { useConnections } from '../hooks/useConnections'
import { usePulse } from '../hooks/usePulse'
import { logoFor, needsAttention, STATUS_BADGE, timeAgo, type InstitutionCard } from '../lib/connections'
import { clock, tradeDayShort } from '../lib/dates'
import { dir, num, plural, qty, share, signed, signedPct } from '../lib/format'
import { holdingRows, sortRows, type Profiles } from '../lib/holdings'
import { KIND_LABEL } from '../lib/kinds'
import { move, rowIn } from '../lib/motion'
import { accountDayChange, displaySymbol, portfolioDayChange } from '../lib/portfolio'
import { hashFor, holdingHash } from '../lib/route'
import { roomLeft } from '../lib/samples'
import type { PortfolioSnapshot } from '../types'

const cols = (c: string, minWidth?: number) => ({ '--cols': c, minWidth }) as CSSProperties

/** Last sync per account id, from the connection that owns it. */
function syncedAt(cards: InstitutionCard[]): Map<number, string | null> {
  const m = new Map<number, string | null>()
  for (const c of cards) for (const a of c.accounts) m.set(a.id, c.lastSyncedAt)
  return m
}

function SyncButton() {
  const { syncAll, busy, cards } = useConnections()
  const [ref, pulse] = usePulse<HTMLButtonElement>()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setDone(false), 2000)
    return () => window.clearTimeout(t)
  }, [done])
  const syncing = busy?.startsWith('sync:') ?? false
  return (
    <button type="button" className="btn o" ref={ref} disabled={busy !== null || cards.length === 0}
      onClick={async () => { if (await syncAll()) { setDone(true); pulse() } }}>
      <IconSwap id={done ? 'check' : 'sync'}><Icon name={done ? 'check' : 'sync'} /></IconSwap>
      {syncing ? 'Syncing…' : done ? 'Synced' : 'Sync now'}
    </button>
  )
}

function Institutions() {
  const { cards, catalog, busy, disconnect, reconnectSnapTrade } = useConnections()
  const [confirming, setConfirming] = useState<{ card: InstitutionCard; from: DOMRect } | null>(null)
  if (cards.length === 0) return null
  return (
    <section className="p c12">
      <div className="ph"><h2>Linked institutions</h2><span className="m" style={{ fontSize: 12 }}>Read-only. InvestIQ cannot place trades or move money.</span></div>
      <div className="sx">
        <div className="tb" style={cols('minmax(200px, 1.2fr) 140px minmax(200px, 1fr) 128px 240px', 900)}>
          <div className="tr th"><span>Institution</span><span className="L">Status</span><span className="L">Accounts</span><span>Last sync</span><span>Actions</span></div>
          {cards.map((card, i) => {
            const status = STATUS_BADGE[card.status]
            const urgent = needsAttention(card.status)
            return (
              <motion.div key={`${card.platform}:${card.name}`} className="tr" style={{ minHeight: 48 }} {...rowIn(i)}>
                <span className="inst">
                  <BrokerageLogo name={card.name} url={logoFor(card, catalog)} />
                  <span>{card.name} <span className="m">· {card.platform === 'questrade' ? 'direct' : 'via SnapTrade'}</span></span>
                </span>
                <span className={`L ${urgent ? 'status-warn' : card.status === 'active' ? 'status-ok' : 'm'}`} title={card.lastError ?? undefined}>{status.label}</span>
                <span className="L wr">
                  {card.accounts.length ? card.accounts.map((a) => (
                    <span key={a.id} style={{ marginRight: 10 }}>
                      {a.account_type || 'Account'} <span className="m">{a.account_number}</span>
                      {a.duplicate && <span className="pill" title="Also connected directly, so it is only counted once">Duplicate</span>}
                      {a.removed && <span className="pill" title="The broker no longer reports this account">Not reported</span>}
                    </span>
                  )) : <span className="m">No accounts synced yet</span>}
                </span>
                <span className="m" title={card.lastSyncedAt ? new Date(card.lastSyncedAt).toLocaleString() : undefined}>
                  {card.lastSyncedAt ? timeAgo(card.lastSyncedAt) : '—'}
                </span>
                <span className="actions" style={{ justifyContent: 'flex-end', overflow: 'visible' }}>
                  {(urgent || card.platform === 'questrade') && (
                    card.platform === 'questrade'
                      ? <a className={`btn ${urgent ? '' : 'o'}`} href={hashFor('connect', { institution: 'questrade' })}>Reconnect</a>
                      : <button type="button" className="btn" disabled={busy !== null} onClick={() => void reconnectSnapTrade(card.name)}>Reconnect</button>
                  )}
                  <button type="button" className="btn danger" disabled={busy !== null}
                    onClick={(e) => setConfirming({ card, from: e.currentTarget.getBoundingClientRect() })}>Disconnect</button>
                </span>
              </motion.div>
            )
          })}
        </div>
      </div>
      <Modal open={confirming !== null} onClose={() => setConfirming(null)} trigger={confirming?.from ?? null} labelledBy="disconnect-title">
        {confirming && (
          <>
            <h2 id="disconnect-title">Disconnect {confirming.card.name}?</h2>
            <p>
              This permanently deletes {confirming.card.accounts.length ? plural(confirming.card.accounts.length, 'account', 'accounts') : 'its accounts'},
              their transactions and holdings from InvestIQ{confirming.card.platform === 'snaptrade' ? ' and unlinks it from SnapTrade' : ''}.
            </p>
            <p className="m">Nothing changes in your {confirming.card.name} account itself, and you can connect it again later.</p>
            <div className="modal-actions">
              <button type="button" className="btn o" autoFocus onClick={() => setConfirming(null)}>Cancel</button>
              <button type="button" className="btn danger" onClick={() => { const c = confirming.card; setConfirming(null); void disconnect(c) }}>Disconnect</button>
            </div>
          </>
        )}
      </Modal>
    </section>
  )
}

function RecentActivity() {
  const { get } = useAccounts()
  const state = useAsync('recent-activity', (signal) => fetchLedger({ kinds: [] }, 5, 0, signal))
  return (
    <section className="p c8">
      <div className="ph"><h2>Recent activity</h2><a href={hashFor('accounts', { view: 'history' })}>Full history</a></div>
      <div className="sx">
        <div className="tb" style={cols('72px 112px 72px minmax(96px, 1fr) 80px 80px 96px', 640)}>
          <div className="tr th"><span>Date</span><span className="L">Type</span><span className="L">Symbol</span><span className="L">Account</span><span>Qty</span><span>Price</span><span>Amount</span></div>
          {state.status === 'loading' && <div className="tr"><span className="m">Loading…</span></div>}
          {state.status === 'error' && <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>Couldn’t load recent activity.</span></div>}
          {state.status === 'ready' && state.data.items.length === 0 && <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>No transactions yet.</span></div>}
          {state.status === 'ready' && state.data.items.map((t, i) => (
            <motion.div key={t.id} className="tr hv" {...rowIn(i)}>
              <span>{tradeDayShort(t.trade_date)}</span>
              <span className="L">{KIND_LABEL[t.kind]}</span>
              <span className="L">{t.symbol ? <a href={holdingHash(t.symbol)} className="sym">{displaySymbol(t.symbol)}</a> : <span className="m">—</span>}</span>
              <span className="L">{get(t.account_id)?.account_type ?? t.account_type}</span>
              <span>{t.quantity ? qty(t.quantity) : ''}</span>
              <span>{t.kind === 'BUY' || t.kind === 'SELL' || t.kind === 'DIVIDEND' ? num(t.price, t.price < 1 ? 4 : 2) : ''}</span>
              <span className={dir(t.net_amount)}>{signed(t.net_amount)}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Accounts({ snapshot, profiles, params }: { snapshot: PortfolioSnapshot; profiles: Profiles; params: URLSearchParams }) {
  const { get } = useAccounts()
  const { cards, notice, setNotice } = useConnections()
  const wanted = Number(params.get('account'))
  const rows = useMemo(() => [...snapshot.accounts].sort((a, b) => b.total - a.total), [snapshot])
  const [picked, setPicked] = useState<number | null>(null)
  const selectedId = picked ?? (rows.some((r) => r.account_id === wanted) ? wanted : rows[0]?.account_id)
  const selected = rows.find((r) => r.account_id === selectedId)
  const positions = useMemo(
    () => (selected ? sortRows(holdingRows(snapshot, profiles, selected.account_id), 'marketValue', 'desc', snapshot.fx_rates) : []),
    [snapshot, profiles, selected],
  )
  const synced = syncedAt(cards)
  const last = [...synced.values()].filter(Boolean).sort().at(-1)
  const institutions = new Set(rows.map((r) => get(r.account_id)?.institution).filter(Boolean)).size
  const totals = rows.reduce((t, a) => ({ cash: t.cash + a.cash_value, book: t.book + a.cost_basis, pnl: t.pnl + a.unrealized_pnl }), { cash: 0, book: 0, pnl: 0 })
  const day = portfolioDayChange(snapshot)

  const banner = notice && (
    <p className={`banner${notice.tone === 'warn' ? ' warn' : ''}`} role={notice.tone === 'warn' ? 'alert' : 'status'}>
      {notice.text}<button type="button" className="link-btn" onClick={() => setNotice(null)}>Dismiss</button>
    </p>
  )

  if (params.get('view') === 'history') {
    return (
      <>
        <nav className="crumb m" aria-label="Breadcrumb"><a href={hashFor('accounts')}>Accounts</a><span>/</span><span style={{ color: 'var(--ink)' }}>History</span></nav>
        <div className="page-head"><div className="page-title"><h1>Transaction history</h1><span className="m">Every stored transaction across your linked accounts</span></div></div>
        <Ledger />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <h1>Accounts</h1>
          <span className="m">{plural(rows.length, 'account', 'accounts')} at {plural(institutions, 'institution', 'institutions')}{last ? ` · last sync ${clock(last)}` : ''}</span>
        </div>
        <div className="actions">
          <SyncButton />
          <a href={hashFor('connect')} className="btn">Connect account</a>
        </div>
      </div>
      {banner}
      {rows.length === 0 ? <NoAccounts /> : (
        <div className="grid">
          <section className="p c12">
            <div className="ph"><h2>Linked accounts</h2><span className="m" style={{ fontSize: 12 }}>Select an account to see its positions</span></div>
            <div className="sx">
              <LayoutGroup id="accounts">
                <div className="tb" style={cols('minmax(150px, 1fr) minmax(150px, 1fr) 116px 72px 96px 108px 172px 104px 80px', 1120)}>
                  <div className="tr th"><span>Account</span><span className="L">Institution</span><span>Market value</span><span>Day</span><span>Cash</span><span>Book cost</span><span>Unrealized</span><span>Room left</span><span>Synced</span></div>
                  {rows.map((a, i) => {
                    const acct = get(a.account_id)
                    const d = accountDayChange(snapshot, a.account_id)
                    const on = a.account_id === selectedId
                    const room = roomLeft(acct?.account_type)
                    const when = synced.get(a.account_id)
                    return (
                      <motion.button key={a.account_id} type="button" className={`tr hv acct${on ? ' on' : ''}`} aria-pressed={on}
                        onClick={() => setPicked(a.account_id)} {...rowIn(i)}>
                        <span style={{ fontWeight: 600 }}>{acct?.account_type || `Account ${a.account_id}`}<span className="m" style={{ fontWeight: 400, marginLeft: 8 }}>{acct?.account_number}</span></span>
                        <span className="L" style={{ color: 'var(--ink2)' }}>{acct?.institution ?? '—'}</span>
                        <span>{num(a.total)}</span>
                        <span className={dir(d.pct)}>{signedPct(d.pct)}</span>
                        <span>{num(a.cash_value)}</span>
                        <span>{num(a.cost_basis)}</span>
                        <span className={dir(a.unrealized_pnl)}>{signed(a.unrealized_pnl)} ({signedPct(a.unrealized_pct, 1)})</span>
                        <span title="Sample contribution room">{room === null ? '—' : num(room)}</span>
                        <span className="m">{when ? clock(when) : '—'}</span>
                        {/* One selection bar that slides to the picked row (last child: it stays out of the columns). */}
                        {on && <motion.span layoutId="acct-bar" className="acct-bar" transition={move} />}
                      </motion.button>
                    )
                  })}
                  <div className="tr tot">
                    <span>Total</span><span /><span>{num(snapshot.total_assets_base)}</span><span className={dir(day.pct)}>{signedPct(day.pct)}</span>
                    <span>{num(totals.cash)}</span><span>{num(totals.book)}</span>
                    <span className={dir(totals.pnl)}>{signed(totals.pnl)} ({signedPct(totals.book ? (totals.pnl / totals.book) * 100 : null, 1)})</span>
                    <span><SampleTag what="Room left" /></span><span />
                  </div>
                </div>
              </LayoutGroup>
            </div>
          </section>

          {selected && (
            <section className="p c12">
              <div className="ph">
                <h2>{get(selected.account_id)?.account_type ?? 'Account'} · {get(selected.account_id)?.institution} — positions</h2>
                <span className="m" style={{ fontSize: 12 }}>{plural(positions.length, 'position', 'positions')} + cash</span>
              </div>
              <div className="sx">
                <div className="tb" style={cols('72px minmax(200px, 1fr) 88px 88px 88px 72px 104px 104px 104px 80px 72px', 1130)}>
                  <div className="tr th"><span>Symbol</span><span className="L">Name</span><span>Qty</span><span>Avg cost</span><span>Price</span><span>Day</span><span>Mkt value</span><span>Book cost</span><span>Unrl. $</span><span>Unrl. %</span><span>Weight</span></div>
                  {positions.map((r, i) => {
                    const w = r.valueBase !== null && selected.total ? (r.valueBase / selected.total) * 100 : null
                    return (
                      <motion.div key={`${selected.account_id}:${r.key}`} className="tr hv" {...rowIn(i)}>
                        <span><a href={holdingHash(r.symbol)} className="sym">{displaySymbol(r.symbol)}</a></span>
                        <span className="L" style={{ color: 'var(--ink2)' }}>{r.profile?.name ?? '—'}{r.currency !== snapshot.base_currency ? ` · ${r.currency}` : ''}</span>
                        <span>{qty(r.quantity)}</span><span>{num(r.averageCost)}</span><span>{num(r.price)}</span>
                        <span className={dir(r.dayChangePct)}>{signedPct(r.dayChangePct)}</span>
                        <span>{num(r.marketValue)}</span><span>{num(r.costBasis)}</span>
                        <span className={dir(r.pnl)}>{signed(r.pnl)}</span><span className={dir(r.pnlPct)}>{signedPct(r.pnlPct, 1)}</span>
                        <span>{share(w)}</span>
                      </motion.div>
                    )
                  })}
                  {selected.cash.map((c) => (
                    <div key={c.currency} className="tr">
                      <span className="m">—</span>
                      <span className="L" style={{ color: 'var(--ink2)' }}>Cash · {c.currency}{c.estimated ? ' · estimated' : ''}</span>
                      <span /><span /><span /><span />
                      <span>{num(c.amount)}</span><span /><span /><span />
                      <span>{share(selected.total ? ((c.amount * (snapshot.fx_rates[c.currency.toUpperCase()] ?? 0)) / selected.total) * 100 : null)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <RecentActivity />
          <section className="p c4">
            <div className="ph"><RoomHeading /></div>
            <ContributionRoom columns="full" />
            <div className="note">Limits are estimates. Confirm in CRA My Account.</div>
          </section>
          <Institutions />
        </div>
      )}
    </>
  )
}
