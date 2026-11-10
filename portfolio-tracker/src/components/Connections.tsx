import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, connectQuestradeToken, disconnect, fetchBrokerages, fetchConnections, syncPlatform } from '../api/client'
import { useAccounts } from '../hooks/useAccounts'
import {
  institutionCards, logoFor, needsAttention, outcomeOf, STATUS_BADGE, timeAgo, type InstitutionCard, type Outcome,
} from '../lib/connections'
import { plural } from '../lib/format'
import { hashFor, parseHash } from '../lib/route'
import { LINK_CHANNEL, openSnapTradePortal } from '../lib/snaptradePortal'
import type { BrokerageCatalog, BrokerageId, BrokerageOption, ConnectionsOverview, Platform } from '../types'
import { BrokerageLogo } from './BrokerageLogo'
import { ConnectBrokerageDialog } from './ConnectBrokerageDialog'
import { Empty } from './Panel'

const PLATFORM_NAME: Record<Platform, string> = { questrade: 'Questrade', snaptrade: 'SnapTrade' }

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function StatusBadge({ card }: { card: InstitutionCard }) {
  const { label, tone } = STATUS_BADGE[card.status]
  return <span className={`badge ${tone}`}><span className="dot" aria-hidden="true" />{label}</span>
}

function CardView({ card, logo, children }: { card: InstitutionCard; logo: string | null; children: ReactNode }) {
  return (
    <section className="panel conn-card" aria-label={card.name}>
      <header className="conn-head">
        <div className="conn-title">
          <BrokerageLogo name={card.name} url={logo} />
          <div>
            <h2>{card.name}</h2>
            <p className="muted small">{card.platform === 'questrade' ? 'Direct connection' : 'Through SnapTrade'} · read-only</p>
          </div>
        </div>
        <StatusBadge card={card} />
      </header>
      {card.lastError && needsAttention(card.status) && <p className="conn-error small" title={card.lastError}>{card.lastError}</p>}
      {card.accounts.length > 0 ? (
        <ul className="conn-accounts">
          {card.accounts.map((a) => (
            <li key={a.id}>
              <span className="conn-account-type">{a.account_type || 'Account'}</span>
              <span className="muted">{a.account_number}</span>
              {a.duplicate && <span className="pill" title="Also connected directly, so it is only counted once">Duplicate</span>}
              {a.removed && <span className="pill" title="The broker no longer reports this account">Not reported</span>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">No accounts synced yet.</p>}
      {card.lastSyncedAt && (
        <p className="muted small" title={new Date(card.lastSyncedAt).toLocaleString()}>Last synced {timeAgo(card.lastSyncedAt)}</p>
      )}
      <div className="conn-body">{children}</div>
    </section>
  )
}

function ConfirmDisconnect({ card, onCancel, onConfirm }: { card: InstitutionCard; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="disconnect-title"
      onCancel={(e) => { e.preventDefault(); onCancel() }}>
      <h2 id="disconnect-title">Disconnect {card.name}?</h2>
      <p>
        This permanently deletes {card.accounts.length ? plural(card.accounts.length, 'account', 'accounts') : 'its accounts'},
        their transactions and holdings from InvestIQ{card.platform === 'snaptrade' ? ' and unlinks it from SnapTrade' : ''}.
      </p>
      <p className="muted small">Nothing changes in your {card.name} account itself, and you can connect it again later.</p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="btn danger" onClick={onConfirm}>Disconnect</button>
      </div>
    </dialog>
  )
}

interface SyncResult { accounts: number; transactions_added: number }

export function Connections() {
  const accounts = useAccounts()
  const [overview, setOverview] = useState<ConnectionsOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // What a broker sign-in reported when it came back here (#/connections?linked=…).
  const [arrival] = useState(() => outcomeOf(parseHash(window.location.hash).params))
  const [notice, setNotice] = useState<Outcome | null>(arrival)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<InstitutionCard | null>(null)
  const [catalog, setCatalog] = useState<BrokerageCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  // The connect dialog: closed (null), at the picker ({}), or at one brokerage's sign-in.
  const [connecting, setConnecting] = useState<{ initial?: BrokerageId } | null>(null)

  const { reload: reloadAccounts } = accounts
  const refresh = useCallback(() => {
    fetchConnections().then(
      (data) => { setOverview(data); setLoadError(null) },
      (e: unknown) => setLoadError(errorText(e)),
    )
    // Also refreshes the picker's "Connected" tags.
    fetchBrokerages().then(
      (data) => { setCatalog(data); setCatalogError(null) },
      (e: unknown) => setCatalogError(errorText(e)),
    )
    reloadAccounts()
  }, [reloadAccounts])

  const sync = useCallback(async (platform: Platform, linked = false) => {
    setBusy(`sync:${platform}`)
    try {
      const result = await syncPlatform(platform) as SyncResult
      const name = platform === 'questrade' ? 'Questrade' : linked ? 'Institution' : 'SnapTrade'
      setNotice({
        tone: 'ok',
        text: `${name} ${linked ? 'linked and synced' : 'synced'}: ${plural(result.accounts, 'account', 'accounts')}, `
          + `${plural(result.transactions_added, 'new transaction', 'new transactions')}.`,
      })
    } catch (e) {
      // Another window (or the scheduler) is already syncing it: its result shows up on refresh.
      if (!(e instanceof ApiError && e.code === 'sync_in_progress')) {
        const reauth = e instanceof ApiError && e.code === 'needs_reauth'
        setNotice({
          tone: 'warn',
          text: reauth ? `${PLATFORM_NAME[platform]} needs you to sign in again.` : `Sync failed: ${errorText(e)}`,
        })
      }
    } finally {
      setBusy(null)
      refresh()
    }
  }, [refresh])

  useEffect(() => { refresh() }, [refresh])

  // Report a finished link to the window that opened the portal and close this popup; when this is
  // not a popup (full-page sign-in, or the portal cut the opener off), sync right here.
  // Runs once even when effects run twice in development (the first timer is cleared).
  useEffect(() => {
    if (!arrival) return
    window.history.replaceState(null, '', hashFor('connections'))
    const platform = arrival.sync
    if (!platform) return
    const timer = window.setTimeout(() => {
      const channel = new BroadcastChannel(LINK_CHANNEL)
      channel.postMessage({ linked: platform })
      channel.close()
      if (window.opener) window.close()
      else void sync(platform, true)
    })
    return () => window.clearTimeout(timer)
  }, [arrival, sync])

  useEffect(() => {
    const channel = new BroadcastChannel(LINK_CHANNEL)
    channel.onmessage = (e: MessageEvent<{ linked?: Platform }>) => {
      if (e.data?.linked) void sync(e.data.linked, true)
    }
    return () => channel.close()
  }, [sync])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setNotice(null)
    try {
      await action()
    } catch (e) {
      setNotice({ tone: 'warn', text: errorText(e) })
    } finally {
      setBusy((current) => (current === key ? null : current))
    }
  }

  const linkThroughSnapTrade = (opts: { reconnectInstitution: string }) => run('portal', async () => {
    if (await openSnapTradePortal(opts) === 'closed') await sync('snaptrade')
  })

  // The dialog shows these errors itself, so they are not caught here.
  const connectWithToken = async (token: string) => {
    await connectQuestradeToken(token)
    setConnecting(null)
    await sync('questrade', true)
  }
  const connectThroughSnapTrade = async (option: BrokerageOption) => {
    const result = await openSnapTradePortal({ broker: option.snaptrade_slug ?? undefined })
    setConnecting(null)
    if (result === 'closed') await sync('snaptrade')
  }

  const confirmDisconnect = (card: InstitutionCard) => {
    setConfirming(null)
    void run(`disconnect:${card.name}`, async () => {
      await disconnect(card.platform, card.platform === 'snaptrade' ? card.name : undefined)
      setNotice({ tone: 'ok', text: `${card.name} disconnected and its data deleted.` })
      refresh()
    })
  }

  if (!overview) {
    return loadError ? (
      <Empty tone="error">
        Couldn’t load your connections. <button type="button" className="link-btn" onClick={refresh}>Try again</button>
      </Empty>
    ) : <Empty>Loading connections…</Empty>
  }

  const cards = institutionCards(overview)
  const locked = busy !== null
  const connectButton = (
    <button type="button" className="btn primary" disabled={locked} onClick={() => setConnecting({})}>
      Connect a brokerage
    </button>
  )

  const syncButton = (platform: Platform) => (
    <button type="button" className="btn" disabled={locked} onClick={() => void sync(platform)}
      title={platform === 'snaptrade' ? 'Syncs every institution linked through SnapTrade' : undefined}>
      {busy === `sync:${platform}` ? 'Syncing…' : 'Sync now'}
    </button>
  )
  const actions = (card: InstitutionCard) => {
    const urgent = needsAttention(card.status)
    const reconnect = card.platform === 'questrade'
      ? () => setConnecting({ initial: 'questrade' })
      : () => void linkThroughSnapTrade({ reconnectInstitution: card.name })
    return (
      <div className="conn-actions">
        {syncButton(card.platform)}
        {(urgent || card.platform === 'questrade') && (
          <button type="button" className={`btn${urgent ? ' primary' : ''}`} disabled={locked} onClick={reconnect}>Reconnect</button>
        )}
        <button type="button" className="btn danger" disabled={locked} onClick={() => setConfirming(card)}>Disconnect</button>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar conn-toolbar">
        <p className="muted small">
          InvestIQ only reads balances, holdings and transactions. It never asks for your broker password and can’t place trades.
        </p>
        {cards.length > 0 && connectButton}
      </div>
      {notice && (
        <p className={`banner${notice.tone === 'warn' ? ' warn' : ''}`} role={notice.tone === 'warn' ? 'alert' : 'status'}>
          {notice.text} <button type="button" className="link-btn" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
      {loadError && <p className="banner warn" role="alert">Couldn’t refresh: {loadError}</p>}

      {cards.length === 0 ? (
        <div className="state conn-empty">
          <p className="offline-title">No brokerages connected yet</p>
          <p className="muted small">Connect Questrade or Wealthsimple to see your holdings and transactions here.</p>
          {connectButton}
        </div>
      ) : (
        <div className="conn-grid">
          {cards.map((card) => (
            <CardView key={`${card.platform}:${card.name}`} card={card} logo={logoFor(card, catalog)}>{actions(card)}</CardView>
          ))}
        </div>
      )}

      {connecting && (
        <ConnectBrokerageDialog catalog={catalog} catalogError={catalogError} initial={connecting.initial}
          onToken={connectWithToken} onSnapTrade={connectThroughSnapTrade} onClose={() => setConnecting(null)} />
      )}
      {confirming && (
        <ConfirmDisconnect card={confirming} onCancel={() => setConfirming(null)} onConfirm={() => confirmDisconnect(confirming)} />
      )}
    </>
  )
}
