import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, connectQuestradeToken, disconnect, fetchBrokerages, fetchConnections, syncPlatform } from '../api/client'
import { institutionCards, type InstitutionCard, type Outcome } from '../lib/connections'
import { plural } from '../lib/format'
import { LINK_CHANNEL, openSnapTradePortal } from '../lib/snaptradePortal'
import type { BrokerageCatalog, BrokerageOption, ConnectionsOverview, Platform } from '../types'

const PLATFORM_NAME: Record<Platform, string> = { questrade: 'Questrade', snaptrade: 'SnapTrade' }
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface SyncResult { accounts: number; transactions_added: number }

export interface Connections {
  overview: ConnectionsOverview | null
  loadError: string | null
  catalog: BrokerageCatalog | null
  catalogError: string | null
  cards: InstitutionCard[]
  /** What the last action reported (sync result, error), until dismissed. */
  notice: Outcome | null
  setNotice: (notice: Outcome | null) => void
  /** `sync:<platform>`, `portal`, `disconnect:<name>`… while an action runs; null when idle. */
  busy: string | null
  refresh: () => void
  /** Resolves true when the sync succeeded (or was already running elsewhere). */
  sync: (platform: Platform, linked?: boolean) => Promise<boolean>
  syncAll: () => Promise<boolean>
  disconnect: (card: InstitutionCard) => Promise<void>
  /** Throws, so the caller can show the error next to the form. */
  connectToken: (token: string) => Promise<void>
  connectSnapTrade: (option: BrokerageOption) => Promise<'closed' | 'redirected'>
  reconnectSnapTrade: (institution: string) => Promise<void>
}

/**
 * Linked brokerages and the actions on them (sync, link, disconnect), loaded once for the app.
 * `onChange` runs after anything that can change accounts (to reload names and the portfolio).
 */
export function useConnectionsLoader(onChange: () => void): Connections {
  const [overview, setOverview] = useState<ConnectionsOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<BrokerageCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const changed = useRef(onChange)
  useEffect(() => { changed.current = onChange })

  const refresh = useCallback(() => {
    fetchConnections().then(
      (data) => { setOverview(data); setLoadError(null) },
      (e: unknown) => setLoadError(errorText(e)),
    )
    fetchBrokerages().then(
      (data) => { setCatalog(data); setCatalogError(null) },
      (e: unknown) => setCatalogError(errorText(e)),
    )
    changed.current()
  }, [])

  useEffect(() => { refresh() }, [refresh])

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
      return true
    } catch (e) {
      // Another window (or the scheduler) is already syncing it: its result shows up on refresh.
      if (e instanceof ApiError && e.code === 'sync_in_progress') return true
      const reauth = e instanceof ApiError && e.code === 'needs_reauth'
      setNotice({ tone: 'warn', text: reauth ? `${PLATFORM_NAME[platform]} needs you to sign in again.` : `Sync failed: ${errorText(e)}` })
      return false
    } finally {
      setBusy(null)
      refresh()
    }
  }, [refresh])

  const platforms = useMemo(
    () => [...new Set((overview?.connections ?? []).filter((c) => c.status !== 'pending').map((c) => c.platform))],
    [overview],
  )
  const syncAll = useCallback(async () => {
    let ok = true
    for (const p of platforms) ok = (await sync(p)) && ok
    return ok
  }, [platforms, sync])

  // A SnapTrade popup that finished reports here (see the Connect page), and this window syncs.
  useEffect(() => {
    const channel = new BroadcastChannel(LINK_CHANNEL)
    channel.onmessage = (e: MessageEvent<{ linked?: Platform }>) => {
      if (e.data?.linked) void sync(e.data.linked, true)
    }
    return () => channel.close()
  }, [sync])

  const remove = useCallback(async (card: InstitutionCard) => {
    setBusy(`disconnect:${card.name}`)
    setNotice(null)
    try {
      await disconnect(card.platform, card.platform === 'snaptrade' ? card.name : undefined)
      setNotice({ tone: 'ok', text: `${card.name} disconnected and its data deleted.` })
    } catch (e) {
      setNotice({ tone: 'warn', text: errorText(e) })
    } finally {
      setBusy(null)
      refresh()
    }
  }, [refresh])

  const connectToken = useCallback(async (token: string) => {
    await connectQuestradeToken(token)
    await sync('questrade', true)
  }, [sync])

  const connectSnapTrade = useCallback(async (option: BrokerageOption) => {
    const result = await openSnapTradePortal({ broker: option.snaptrade_slug ?? undefined })
    if (result === 'closed') await sync('snaptrade', true)
    return result
  }, [sync])

  const reconnectSnapTrade = useCallback(async (institution: string) => {
    setBusy('portal')
    try {
      if (await openSnapTradePortal({ reconnectInstitution: institution }) === 'closed') await sync('snaptrade')
    } catch (e) {
      setNotice({ tone: 'warn', text: errorText(e) })
    } finally {
      setBusy((b) => (b === 'portal' ? null : b))
    }
  }, [sync])

  return useMemo(() => ({
    overview, loadError, catalog, catalogError, cards: overview ? institutionCards(overview) : [],
    notice, setNotice, busy, refresh, sync, syncAll, disconnect: remove, connectToken, connectSnapTrade, reconnectSnapTrade,
  }), [overview, loadError, catalog, catalogError, notice, busy, refresh, sync, syncAll, remove, connectToken, connectSnapTrade, reconnectSnapTrade])
}

const NONE: Connections = {
  overview: null, loadError: null, catalog: null, catalogError: null, cards: [], notice: null, setNotice: () => {},
  busy: null, refresh: () => {}, sync: async () => false, syncAll: async () => false, disconnect: async () => {},
  connectToken: async () => {}, connectSnapTrade: async () => 'closed', reconnectSnapTrade: async () => {},
}

export const ConnectionsContext = createContext<Connections>(NONE)
export const useConnections = () => useContext(ConnectionsContext)
