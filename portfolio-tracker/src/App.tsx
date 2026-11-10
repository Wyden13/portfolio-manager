import { useMemo, useState } from 'react'
import { AllocationPanel } from './components/AllocationDonut'
import { CandlePanel } from './components/CandleChart'
import { GainLossPanel } from './components/GainLossBars'
import { LivePnl } from './components/LivePnl'
import { Empty, Segmented } from './components/Panel'
import { TreemapPanel } from './components/TreemapChart'
import { ValuePanel } from './components/ValueChart'
import { useLivePortfolio, type LiveState } from './hooks/useLivePortfolio'
import { useTheme } from './hooks/useTheme'
import { currenciesOf } from './lib/aggregate'
import { plural } from './lib/format'
import type { Theme } from './lib/theme'
import type { PortfolioSnapshot } from './types'
import './App.css'

function connectionBadge(state: LiveState): { label: string; tone: string } {
  switch (state.status) {
    case 'connecting': return { label: 'Connecting', tone: 'pending' }
    case 'offline': return { label: 'Offline', tone: 'down' }
    case 'sample': return { label: 'Sample data', tone: 'pending' }
    case 'live':
      return state.stream === 'open' ? { label: 'Live', tone: 'up' }
        : state.stream === 'reconnecting' ? { label: 'Reconnecting', tone: 'pending' }
        : { label: 'Updates paused', tone: 'down' }
  }
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === 'dark' ? (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function Dashboard({ snapshot, history, theme }: {
  snapshot: PortfolioSnapshot; history: Extract<LiveState, { status: 'live' }>['history']; theme: Theme
}) {
  const currencies = useMemo(() => currenciesOf(snapshot), [snapshot])
  const [picked, setPicked] = useState<string | null>(null)
  // Follow the first currency until the user picks one, and when the picked one disappears.
  const currency = picked && currencies.includes(picked) ? picked : currencies[0]
  const symbols = useMemo(
    () => [...new Set(snapshot.positions.filter((p) => p.currency === currency).map((p) => p.symbol))].sort(),
    [snapshot, currency],
  )
  const unpriced = snapshot.positions.filter((p) => p.status !== 'ok').length

  if (snapshot.positions.length === 0) {
    return <Empty>No holdings yet. Connect a brokerage and sync it to see your portfolio here.</Empty>
  }
  return (
    <>
      <LivePnl totals={snapshot.totals} history={history} />
      <div className="toolbar">
        {currencies.length > 1 && (
          <Segmented label="Chart currency" value={currency} options={currencies} onChange={setPicked} />
        )}
        <span className="muted small">Updated {new Date(snapshot.as_of).toLocaleTimeString()}</span>
      </div>
      {unpriced > 0 && (
        <p className="banner" role="status">
          {plural(unpriced, 'holding has', 'holdings have')} no live price right now and {unpriced === 1 ? 'is' : 'are'} left out of the charts.
        </p>
      )}
      <div className="grid">
        <TreemapPanel snapshot={snapshot} currency={currency} theme={theme} />
        <AllocationPanel snapshot={snapshot} currency={currency} theme={theme} />
        <GainLossPanel snapshot={snapshot} currency={currency} theme={theme} />
        <ValuePanel currency={currency} theme={theme} />
        <CandlePanel symbols={symbols} theme={theme} />
      </div>
    </>
  )
}

function App() {
  const [theme, toggleTheme] = useTheme()
  const { state, retry } = useLivePortfolio()
  const badge = connectionBadge(state)

  return (
    <div className="app">
      <header className="topbar">
        <h1>InvestIQ</h1>
        <div className="topbar-right">
          <span className={`badge ${badge.tone}`} role="status"><span className="dot" aria-hidden="true" />{badge.label}</span>
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>

      <main>
        {state.status === 'connecting' && <Empty>Loading your portfolio…</Empty>}
        {state.status === 'offline' && (
          <div className="state offline" role="alert">
            <p className="offline-title">Can’t reach the InvestIQ server</p>
            <p className="muted small">{state.error}</p>
            <button type="button" className="btn" onClick={retry}>Try again</button>
          </div>
        )}
        {(state.status === 'live' || state.status === 'sample') && (
          <>
            {state.status === 'live' && state.stream === 'closed' && (
              <p className="banner warn" role="alert">
                Live updates stopped. <button type="button" className="link-btn" onClick={retry}>Reconnect</button>
              </p>
            )}
            <Dashboard snapshot={state.snapshot} history={state.history} theme={theme} />
          </>
        )}
      </main>
    </div>
  )
}

export default App
