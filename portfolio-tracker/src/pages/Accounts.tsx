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
import { useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { useConnections } from '../hooks/useConnections'
import { usePulse } from '../hooks/usePulse'
import { initials, logoFor, needsAttention, STATUS_BADGE, timeAgo, type InstitutionCard } from '../lib/connections'
import { clock, tradeDayShort } from '../lib/dates'
import { dir, dollars, num, plural, qty, share, signed, signedDollars, signedPct } from '../lib/format'
import { holdingRows, sortRows, type Profiles } from '../lib/holdings'
import { activityTitle } from '../lib/kinds'
import { move, rowIn } from '../lib/motion'
import { accountDayChange, displaySymbol } from '../lib/portfolio'
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
    <button type="button" className="btn o s" ref={ref} disabled={busy !== null || cards.length === 0}
      onClick={async () => { if (await syncAll()) { setDone(true); pulse() } }}>
      <IconSwap id={done ? 'check' : 'sync'}><Icon name={done ? 'check' : 'sync'} /></IconSwap>
      {syncing ? 'Syncing…' : done ? 'Synced' : 'Sync now'}
    </button>
  )
}

/** Linked institutions with their status, last sync, and Reconnect / Disconnect. */
function Institutions() {
  const { cards, catalog, busy, disconnect, reconnectSnapTrade } = useConnections()
  const [confirming, setConfirming] = useState<{ card: InstitutionCard; from: DOMRect } | null>(null)
  if (cards.length === 0) return null
  return (
    <section className="card">
      <div className="ch"><h3>Linked institutions</h3><a href={hashFor('connect')}>Add</a></div>
      {cards.map((card, i) => {
        const status = STATUS_BADGE[card.status]
        const urgent = needsAttention(card.status)
        return (
          <motion.div key={`${card.platform}:${card.name}`} className="stack" style={{ gap: 10, padding: '14px 20px', borderTop: '1px solid var(--line)' }} {...rowIn(i)}>
            <div className="inst">
              <BrokerageLogo name={card.name} url={logoFor(card, catalog)} size="sm" />
              <span className="two" style={{ flex: 1 }}>
                <span className="b">{card.name}</span>
                <span className="m small">
                  <span className={urgent ? 'status-warn' : card.status === 'active' ? 'status-ok' : ''} title={card.lastError ?? undefined}>{status.label}</span>
                  {' · '}
                  <span title={card.lastSyncedAt ? new Date(card.lastSyncedAt).toLocaleString() : undefined}>
                    {card.lastSyncedAt ? `synced ${timeAgo(card.lastSyncedAt)}` : 'not synced yet'}
                  </span>
                </span>
              </span>
            </div>
            <span className="m small">
              {card.accounts.length ? card.accounts.map((a, j) => (
                <span key={a.id}>
                  {j > 0 && ', '}{a.account_type || 'Account'} {a.account_number}
                  {a.duplicate && <span className="pill" title="Also connected directly, so it is only counted once">Duplicate</span>}
                  {a.removed && <span className="pill" title="The broker no longer reports this account">Not reported</span>}
                </span>
              )) : 'No accounts synced yet'}
              {card.platform === 'snaptrade' && ' · via SnapTrade'}
            </span>
            <span className="actions">
              {(urgent || card.platform === 'questrade') && (
                card.platform === 'questrade'
                  ? <a className={`btn s ${urgent ? '' : 'o'}`} href={hashFor('connect', { institution: 'questrade' })}>Reconnect</a>
                  : <button type="button" className="btn s" disabled={busy !== null} onClick={() => void reconnectSnapTrade(card.name)}>Reconnect</button>
              )}
              <button type="button" className="btn s danger" disabled={busy !== null}
                onClick={(e) => setConfirming({ card, from: e.currentTarget.getBoundingClientRect() })}>Disconnect</button>
            </span>
          </motion.div>
        )
      })}
      <div className="note">Read-only. InvestIQ can’t place trades or move money.</div>
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
    <section className="card">
      <div className="ch"><h3>Recent activity</h3><a href={hashFor('accounts', { view: 'history' })}>Full history</a></div>
      {state.status === 'loading' && <div className="li m"><span>Loading…</span></div>}
      {state.status === 'error' && <div className="li m"><span>Couldn’t load recent activity.</span></div>}
      {state.status === 'ready' && state.data.items.length === 0 && <div className="li m"><span>No transactions yet.</span></div>}
      {state.status === 'ready' && state.data.items.map((t, i) => (
        <motion.div key={t.id} className="li" {...rowIn(i)}>
          <span className="two">
            {t.symbol
              ? <a href={holdingHash(t.symbol)} className="hl" style={{ fontWeight: 600 }}>{activityTitle(t)}</a>
              : <span style={{ fontWeight: 600 }}>{activityTitle(t)}</span>}
            <span className="m small">{tradeDayShort(t.trade_date)} · {get(t.account_id)?.account_type ?? t.account_type}</span>
          </span>
          <span className={`b ${t.net_amount > 0 ? 'up' : ''}`}>{signedDollars(t.net_amount)}</span>
        </motion.div>
      ))}
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

  const banner = notice && (
    <p className={`banner${notice.tone === 'warn' ? ' warn' : ''}`} role={notice.tone === 'warn' ? 'alert' : 'status'}>
      {notice.text}<button type="button" className="link-btn" onClick={() => setNotice(null)}>Dismiss</button>
    </p>
  )

  if (params.get('view') === 'history') {
    return (
      <div className="stack s20">
        <nav className="crumb m" aria-label="Breadcrumb"><a href={hashFor('accounts')}>Accounts</a><span>/</span><span>History</span></nav>
        <div className="page-head"><div className="page-title"><h1>Transaction history</h1><span className="m">Every stored transaction across your linked accounts</span></div></div>
        <Ledger />
      </div>
    )
  }

  const acct = selected ? get(selected.account_id) : undefined
  const fx = (ccy: string) => snapshot.fx_rates[ccy.toUpperCase()] ?? 0

  return (
    <>
      {banner}
      <div className="layout">
        <div className="main">
          <section className="stack s20">
            <div className="page-head">
              <div className="page-title">
                <h1>Accounts</h1>
                <span className="m">
                  <span className="b" style={{ color: 'var(--ink)' }}>{dollars(snapshot.total_assets_base)}</span> across {plural(rows.length, 'account', 'accounts')} at{' '}
                  {plural(institutions, 'institution', 'institutions')}{last ? ` · synced ${clock(last)}` : ''}
                </span>
              </div>
              <div className="actions">
                <SyncButton />
                <a href={hashFor('connect')} className="btn s">Connect account</a>
              </div>
            </div>
            {rows.length === 0 ? <NoAccounts /> : (
              <LayoutGroup id="accounts">
                <div className="picks">
                  {rows.map((a, i) => {
                    const info = get(a.account_id)
                    const d = accountDayChange(snapshot, a.account_id)
                    const on = a.account_id === selectedId
                    const room = roomLeft(info?.account_type)
                    return (
                      <motion.button key={a.account_id} type="button" className="pick" aria-pressed={on} onClick={() => setPicked(a.account_id)} {...rowIn(i)}>
                        {/* One accent ring that slides to the picked card. */}
                        {on && <motion.span layoutId="pick-ring" className="pick-ring" transition={move} />}
                        <span className="pick-row">
                          <span className="mono">{initials(info?.institution ?? '?')}</span>
                          <span className="two">
                            <span className="b">{info?.account_type || `Account ${a.account_id}`}</span>
                            <span className="m small">{info?.institution ?? ''} {info?.account_number ?? ''}</span>
                          </span>
                        </span>
                        <span className="pick-val">{dollars(a.total)}</span>
                        <span className="pick-foot">
                          <span className={dir(d.pct)} style={{ fontWeight: 600 }}>{signedPct(d.pct)} today</span>
                          <span className="m" title={room === null ? undefined : 'Sample contribution room'}>{room === null ? 'No contribution limit' : `$${num(room, 0)} room left`}</span>
                        </span>
                      </motion.button>
                    )
                  })}
                </div>
              </LayoutGroup>
            )}
          </section>

          {selected && (
            <section className="stack">
              <div className="sh">
                <h2>{acct?.account_type || 'Account'}{acct ? ` · ${acct.institution}` : ''}</h2>
                <span className="m">{plural(positions.length, 'position', 'positions')} + cash</span>
              </div>
              <div className="kpis flat">
                <div><span className="lab">Market value</span><span className="kv">{dollars(selected.total)}</span></div>
                <div><span className="lab">Unrealized P/L</span><span className={`kv ${dir(selected.unrealized_pnl)}`}>{signedDollars(selected.unrealized_pnl)}</span><span className={`small ${dir(selected.unrealized_pct)}`}>{signedPct(selected.unrealized_pct, 1)}</span></div>
                <div><span className="lab">Book cost</span><span className="kv">{dollars(selected.cost_basis)}</span></div>
                <div><span className="lab">Cash</span><span className="kv">{dollars(selected.cash_value)}</span></div>
              </div>
              <div className="sx">
                <div className="tb tbB" style={cols('minmax(160px, 1fr) 64px 72px 72px 72px 104px 112px 56px', 760)}>
                  <div className="tr th"><span>Symbol</span><span>Shares</span><span>Avg cost</span><span>Price</span><span>Today</span><span>Market value</span><span>Unrealized</span><span>Weight</span></div>
                  {positions.map((r, i) => {
                    const w = r.valueBase !== null && selected.total ? (r.valueBase / selected.total) * 100 : null
                    return (
                      <motion.a key={`${selected.account_id}:${r.key}`} href={holdingHash(r.symbol)} className="tr hv" {...rowIn(i)}>
                        <span className="two">
                          <span className="sym">{displaySymbol(r.symbol)}</span>
                          <span className="m small">{r.profile?.name ?? '—'}{r.currency !== snapshot.base_currency ? ` · ${r.currency}` : ''}</span>
                        </span>
                        <span>{qty(r.quantity)}</span>
                        <span className="m2">{num(r.averageCost)}</span>
                        <span>{num(r.price)}</span>
                        <span className={dir(r.dayChangePct)}>{signedPct(r.dayChangePct)}</span>
                        <span className="b">{num(r.marketValue)}</span>
                        <span className={`two ${dir(r.pnl)}`} style={{ textAlign: 'right' }}><span>{signed(r.pnl)}</span><span className="small">{signedPct(r.pnlPct, 1)}</span></span>
                        <span className="m2">{share(w)}</span>
                      </motion.a>
                    )
                  })}
                  {selected.cash.map((c) => (
                    <div key={c.currency} className="tr">
                      <span className="two"><span className="sym">Cash</span><span className="m small">{c.currency}{c.estimated ? ' · estimated' : ''}</span></span>
                      <span /><span /><span /><span />
                      <span className="b">{num(c.amount)}</span>
                      <span />
                      <span className="m2">{share(selected.total ? ((c.amount * fx(c.currency)) / selected.total) * 100 : null)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="rail">
          <section className="card">
            <div className="ch"><RoomHeading /></div>
            <ContributionRoom variant="bars" />
            <div className="note">Estimates. Confirm in CRA My Account.</div>
          </section>
          <Institutions />
          <RecentActivity />
        </aside>
      </div>
    </>
  )
}
