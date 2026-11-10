import { useMemo, useState } from 'react'
import { AllocationPanel } from './components/AllocationDonut'
import { CandlePanel } from './components/CandleChart'
import { GainLossPanel } from './components/GainLossBars'
import { LivePnl } from './components/LivePnl'
import { Empty, Segmented } from './components/Panel'
import { TreemapPanel } from './components/TreemapChart'
import { ValuePanel } from './components/ValueChart'
import { useLivePortfolio } from './hooks/useLivePortfolio'
import { useTheme } from './hooks/useTheme'
import { currenciesOf } from './lib/aggregate'
import './App.css'

const STREAM_LABEL = {
  connecting: 'Connecting…', open: 'Live · updates every 5s', reconnecting: 'Reconnecting…', mock: 'Sample data',
} as const

function App() {
  const [theme, toggleTheme] = useTheme()
  const { snapshot, stream, history, error, source } = useLivePortfolio()
  const currencies = useMemo(() => (snapshot ? currenciesOf(snapshot) : []), [snapshot])
  const [picked, setPicked] = useState<string | null>(null)
  const currency = picked && currencies.includes(picked) ? picked : currencies[0] ?? null
  const symbols = useMemo(
    () => (snapshot && currency ? [...new Set(snapshot.positions.filter((p) => p.currency === currency).map((p) => p.symbol))].sort() : []),
    [snapshot, currency],
  )
  const unpriced = snapshot?.positions.filter((p) => p.status !== 'ok').length ?? 0

  return (
    <div className="app">
      <header className="topbar">
        <h1>InvestIQ</h1>
        <div className="topbar-right">
          <span className={`badge ${stream}`} role="status">{STREAM_LABEL[stream]}</span>
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main>
        {error && <p className="banner" role="alert">{error}</p>}
        {!snapshot ? <Empty>Loading portfolio…</Empty>
          : snapshot.positions.length === 0 ? <Empty>No positions yet. Connect a brokerage and run a sync to see your portfolio.</Empty>
          : (
            <>
              <div className="toolbar">
                {currencies.length > 1 && currency && (
                  <Segmented label="Currency" value={currency} options={currencies} onChange={setPicked} />
                )}
                <span className="muted small">
                  Charts show one currency at a time (no FX conversion). As of {new Date(snapshot.as_of).toLocaleTimeString()}.
                  {source === 'mock' && ' Sample data.'}
                </span>
              </div>
              {unpriced > 0 && <p className="banner" role="status">{unpriced} position(s) have no usable quote and are left out of the charts.</p>}
              <LivePnl totals={snapshot.totals} history={history} />
              {currency && (
                <div className="grid">
                  <TreemapPanel snapshot={snapshot} currency={currency} theme={theme} />
                  <AllocationPanel snapshot={snapshot} currency={currency} theme={theme} />
                  <GainLossPanel snapshot={snapshot} currency={currency} theme={theme} />
                  <ValuePanel snapshot={snapshot} currency={currency} theme={theme} />
                  <CandlePanel symbols={symbols} theme={theme} />
                </div>
              )}
            </>
          )}
      </main>
    </div>
  )
}

export default App
