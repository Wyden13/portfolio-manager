import type { ReactNode } from 'react'
import type { LiveState, PnLHistory } from '../hooks/useLivePortfolio'
import { hashFor } from '../lib/route'
import type { PortfolioSnapshot } from '../types'

/** Loading and offline states for pages built on the live portfolio; never shows made-up numbers. */
export function LiveGate({ state, retry, children }: {
  state: LiveState
  retry: () => void
  children: (snapshot: PortfolioSnapshot, history: PnLHistory) => ReactNode
}) {
  if (state.status === 'connecting') {
    return <div className="state page-state" role="status">Loading your portfolio…</div>
  }
  if (state.status === 'offline') {
    return (
      <div className="state page-state" role="alert">
        <p className="state-title">Can’t reach the InvestIQ server</p>
        <p title={state.error}>Your portfolio will appear as soon as the connection is back.</p>
        <button type="button" className="btn" onClick={retry}>Try again</button>
      </div>
    )
  }
  return (
    <>
      {state.stream === 'closed' && (
        <p className="banner warn" role="alert">
          Live updates stopped.<button type="button" className="link-btn" onClick={retry}>Reconnect</button>
        </p>
      )}
      {children(state.snapshot, state.history)}
    </>
  )
}

/** Shown on portfolio pages before any brokerage is linked. */
export function NoAccounts() {
  return (
    <div className="state page-state">
      <p className="state-title">No accounts linked yet</p>
      <p>Connect a brokerage to see your holdings, returns and news here.</p>
      <a className="btn" href={hashFor('connect')}>Connect an account</a>
    </div>
  )
}
