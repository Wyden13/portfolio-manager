import { useEffect, useRef, useState } from 'react'
import { fetchPositions } from '../api/client'
import { mockSnapshot } from '../api/mock'
import { decodePnLFrame } from '../lib/pnlFrame'
import type { PortfolioSnapshot } from '../types'

/** `live` = backend REST + SSE, `mock` = backend unreachable so fixtures are streamed instead. */
export type DataSource = 'loading' | 'live' | 'mock'
export type StreamState = 'connecting' | 'open' | 'reconnecting' | 'mock'

export interface PnLSample { t: number; pnl: number }
/** Recent unrealized P&L per currency, for sparklines. */
export type PnLHistory = Record<string, PnLSample[]>

export interface LivePortfolio {
  snapshot: PortfolioSnapshot | null
  source: DataSource
  stream: StreamState
  history: PnLHistory
  error: string | null
}

const MAX_SAMPLES = 60
const MOCK_INTERVAL_MS = 5000

function appendHistory(prev: PnLHistory, snap: PortfolioSnapshot): PnLHistory {
  const t = Date.parse(snap.as_of)
  const next: PnLHistory = { ...prev }
  for (const total of snap.totals) {
    if (total.unrealized_pnl === null) continue
    next[total.currency] = [...(prev[total.currency] ?? []), { t, pnl: total.unrealized_pnl }].slice(-MAX_SAMPLES)
  }
  return next
}

export function useLivePortfolio(): LivePortfolio {
  const [state, setState] = useState<LivePortfolio>({
    snapshot: null, source: 'loading', stream: 'connecting', history: {}, error: null,
  })
  const closers = useRef<Array<() => void>>([])

  useEffect(() => {
    const controller = new AbortController()
    const push = (snap: PortfolioSnapshot) =>
      setState((s) => ({ ...s, snapshot: snap, history: appendHistory(s.history, snap) }))

    const startMock = (error: string) => {
      let tick = 0
      const emit = () => {
        push(mockSnapshot(tick++))
        setState((s) => ({ ...s, source: 'mock', stream: 'mock', error }))
      }
      emit()
      const id = window.setInterval(emit, MOCK_INTERVAL_MS)
      closers.current.push(() => window.clearInterval(id))
    }

    const startLive = (initial: PortfolioSnapshot) => {
      push(initial)
      setState((s) => ({ ...s, source: 'live', error: null }))
      const es = new EventSource('/api/stream/pnl')
      es.onopen = () => setState((s) => ({ ...s, stream: 'open' }))
      es.onmessage = (ev) => {
        try {
          push(decodePnLFrame(ev.data))
        } catch (err) {
          setState((s) => ({ ...s, error: `Bad stream frame: ${(err as Error).message}` }))
        }
      }
      // EventSource reconnects by itself; we only surface the state.
      es.onerror = () => setState((s) => ({ ...s, stream: 'reconnecting' }))
      closers.current.push(() => es.close())
    }

    fetchPositions(controller.signal)
      .then(startLive)
      .catch((err: Error) => {
        if (controller.signal.aborted) return
        startMock(`Backend unreachable (${err.message}); showing sample data.`)
      })

    const close = closers.current
    return () => {
      controller.abort()
      close.splice(0).forEach((fn) => fn())
    }
  }, [])

  return state
}
