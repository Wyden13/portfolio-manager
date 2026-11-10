import { useCallback, useEffect, useState } from 'react'
import { fetchPositions } from '../api/client'
import { mockSnapshot } from '../api/mock'
import { decodePnLFrame } from '../lib/pnlFrame'
import type { PortfolioSnapshot } from '../types'

export interface PnLSample { t: number; pnl: number }
/** Recent unrealized P&L per currency, for sparklines. */
export type PnLHistory = Record<string, PnLSample[]>

/**
 * connecting: first REST load in flight, nothing to show yet.
 * offline:    the REST load failed; nothing to show, the user can retry.
 * live:       we have a snapshot; `stream` says whether updates are flowing.
 *             open = SSE connected, reconnecting = the browser is retrying by itself,
 *             closed = the server refused the stream (no automatic retry).
 * sample:     backend unreachable, fixtures are streamed instead.
 */
export type LiveState =
  | { status: 'connecting' }
  | { status: 'offline'; error: string }
  | { status: 'live'; snapshot: PortfolioSnapshot; history: PnLHistory; stream: StreamState }
  | { status: 'sample'; snapshot: PortfolioSnapshot; history: PnLHistory }

export type StreamState = 'open' | 'reconnecting' | 'closed'

const MAX_SAMPLES = 60
const MOCK_INTERVAL_MS = 5000
// The backend names its SSE events `pnl` (see backend/app/services/streaming.py).
const PNL_EVENT = 'pnl'

function appendHistory(prev: PnLHistory, snap: PortfolioSnapshot): PnLHistory {
  const t = Date.parse(snap.as_of)
  const next: PnLHistory = { ...prev }
  for (const total of snap.totals) {
    if (total.unrealized_pnl === null) continue
    const samples = prev[total.currency] ?? []
    if (samples.at(-1)?.t === t) continue // the REST snapshot and the first SSE frame can coincide
    next[total.currency] = [...samples, { t, pnl: total.unrealized_pnl }].slice(-MAX_SAMPLES)
  }
  return next
}

export function useLivePortfolio(): { state: LiveState; retry: () => void } {
  const [state, setState] = useState<LiveState>({ status: 'connecting' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const cleanups: Array<() => void> = []

    const push = (status: 'live' | 'sample', snap: PortfolioSnapshot) =>
      setState((s) => {
        const history = appendHistory(s.status === 'live' || s.status === 'sample' ? s.history : {}, snap)
        if (status === 'sample') return { status, snapshot: snap, history }
        return { status, snapshot: snap, history, stream: s.status === 'live' ? s.stream : 'open' }
      })
    const setStream = (stream: StreamState) =>
      setState((s) => (s.status === 'live' ? { ...s, stream } : s))

    const startSample = () => {
      let tick = 0
      const emit = () => push('sample', mockSnapshot(tick++))
      emit()
      const id = window.setInterval(emit, MOCK_INTERVAL_MS)
      cleanups.push(() => window.clearInterval(id))
    }

    const startLive = (initial: PortfolioSnapshot) => {
      push('live', initial)
      const es = new EventSource('/api/stream/pnl')
      es.onopen = () => setStream('open')
      es.addEventListener(PNL_EVENT, (ev) => {
        try {
          push('live', decodePnLFrame((ev as MessageEvent<string>).data))
        } catch (err) {
          // One bad frame shouldn't blank the dashboard; the next one arrives within seconds.
          console.error('Skipping undecodable P&L frame', err)
        }
      })
      // EventSource retries on its own unless the server answered with an error (CLOSED).
      es.onerror = () => setStream(es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting')
      cleanups.push(() => es.close())
    }

    fetchPositions(controller.signal)
      .then(startLive)
      .catch(() => {
        if (!controller.signal.aborted) startSample()
      })

    return () => {
      controller.abort()
      cleanups.forEach((fn) => fn())
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'connecting' })
    setAttempt((n) => n + 1)
  }, [])

  return { state, retry }
}
