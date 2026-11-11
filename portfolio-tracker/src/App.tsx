import { useCallback, useMemo, useState } from 'react'
import { AccountCards } from './components/AccountCards'
import { AccountPerformancePanel } from './components/AccountPerformance'
import { CandlePanel } from './components/CandleChart'
import { Connections } from './components/Connections'
import { GainLossPanel } from './components/GainLossBars'
import { HoldingsTable } from './components/HoldingsTable'
import { Ledger } from './components/Ledger'
import { Empty, Segmented } from './components/Panel'
import { TopHoldings } from './components/TopHoldings'
import { TotalAssetsCard } from './components/TotalAssetsCard'
import { TreemapPanel } from './components/TreemapChart'
import { AccountsContext, useAccounts, useAccountsLoader } from './hooks/useAccounts'
import { useHashTab, type Tab } from './hooks/useHashTab'
import { useLivePortfolio, type LiveState, type PnLHistory } from './hooks/useLivePortfolio'
import { useTheme } from './hooks/useTheme'
import { currenciesOf } from './lib/aggregate'
import { hashFor } from './lib/route'
import { plural } from './lib/format'
import { PALETTES, type Theme } from './lib/theme'
import type { PortfolioSnapshot } from './types'
import './App.css'

function connectionBadge(state: LiveState): { label: string; tone: string } {
  switch (state.status) {
    case 'connecting': return { label: 'Connecting', tone: 'pending' }
    case 'offline': return { label: 'Offline', tone: 'down' }
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
  snapshot: PortfolioSnapshot; history: PnLHistory; theme: Theme
}) {
  const currencies = useMemo(() => currenciesOf(snapshot), [snapshot])
  const [picked, setPicked] = useState<string | null>(null)
  // Follow the first currency until the user picks one, and when the picked one disappears.
  const currency = picked && currencies.includes(picked) ? picked : currencies[0]
  const symbols = useMemo(
    () => [...new Set(snapshot.positions.filter((p) => p.currency === currency).map((p) => p.symbol))].sort(),
    [snapshot, currency],
  )
  const unpriced = snapshot.positions.filter((p) => p.status === 'no_quote' || p.status === 'currency_mismatch').length
  const uncosted = snapshot.positions.filter((p) => p.status === 'no_cost').length
  const base = snapshot.base_currency ?? snapshot.base_total?.currency ?? currency ?? ''

  // One colour per account, by its place among linked accounts, so card swatches match chart lines.
  const { list } = useAccounts()
  const colorOf = useCallback((accountId: number) => {
    const series = PALETTES[theme].series
    const i = list.findIndex((a) => a.id === accountId)
    return series[(i >= 0 ? i : list.length + accountId) % series.length]
  }, [list, theme])
  const accountsKey = snapshot.accounts.map((a) => a.account_id).join(',')

  if (snapshot.positions.length === 0 && snapshot.accounts.length === 0) {
    return <Empty>No holdings yet. <a href={hashFor('connections')}>Connect a brokerage</a> to see your portfolio here.</Empty>
  }
  return (
    <>
      <div className="toolbar">
        <h2 className="section-title">Overview</h2>
        <span className="muted small">Updated {new Date(snapshot.as_of).toLocaleTimeString()}</span>
      </div>
      {unpriced > 0 && (
        <p className="banner" role="status">
          {plural(unpriced, 'holding has', 'holdings have')} no live price right now and {unpriced === 1 ? 'is' : 'are'} left out of the charts.
        </p>
      )}
      {uncosted > 0 && (
        <p className="banner" role="status">
          The broker reported no cost basis for {plural(uncosted, 'holding', 'holdings')}, so {uncosted === 1 ? 'it counts' : 'they count'} toward value but not gain or loss.
        </p>
      )}
      <div className="grid">
        <TotalAssetsCard snapshot={snapshot} history={history} base={base} theme={theme} />
        <AccountPerformancePanel accountsKey={accountsKey} colorOf={colorOf} theme={theme} />
      </div>
      {snapshot.accounts.length > 0 && (
        <AccountCards accounts={snapshot.accounts} base={base} totalAssets={snapshot.total_assets_base} colorOf={colorOf} />
      )}
      {snapshot.positions.length > 0 && (
        <div className="grid top-holdings"><TopHoldings snapshot={snapshot} /></div>
      )}
      {currency && (
        <>
          <div className="toolbar">
            <h2 className="section-title">Holdings</h2>
            {currencies.length > 1 && (
              <Segmented label="Holdings currency" value={currency} options={currencies} onChange={setPicked} />
            )}
          </div>
          <div className="grid">
            <TreemapPanel snapshot={snapshot} currency={currency} theme={theme} />
            <GainLossPanel snapshot={snapshot} currency={currency} theme={theme} />
            <CandlePanel symbols={symbols} theme={theme} />
          </div>
        </>
      )}
    </>
  )
}

const TABS: Array<[Tab, string]> = [['dashboard', 'Dashboard'], ['holdings', 'Holdings'], ['ledger', 'Ledger'], ['connections', 'Connections']]

function App() {
  const [theme, toggleTheme] = useTheme()
  const [tab, openTab] = useHashTab()
  const { state, retry } = useLivePortfolio()
  // Reload account names once the server is reachable (they label charts and ledger filters).
  const accounts = useAccountsLoader(state.status === 'live' ? 1 : 0)
  const badge = connectionBadge(state)
  // Tabs that show the live portfolio (and its loading and offline states).
  const live = tab === 'dashboard' || tab === 'holdings'

  return (
    <AccountsContext.Provider value={accounts}>
      <div className={`app${tab === 'holdings' ? ' wide' : ''}`}>
        <header className="topbar">
          <h1>InvestIQ</h1>
          <nav className="tabs" aria-label="Views">
            {TABS.map(([id, label]) => (
              <a key={id} href={hashFor(id)} aria-current={tab === id ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); openTab(id) }}>
                {label}
              </a>
            ))}
          </nav>
          <div className="topbar-right">
            <span className={`badge ${badge.tone}`} role="status"><span className="dot" aria-hidden="true" />{badge.label}</span>
            <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              <ThemeIcon theme={theme} />
            </button>
          </div>
        </header>

        <main>
          {tab === 'ledger' && <Ledger />}
          {tab === 'connections' && <Connections />}
          {live && state.status === 'connecting' && <Empty>Loading your portfolio…</Empty>}
          {live && state.status === 'offline' && (
            <div className="state offline" role="alert">
              <p className="offline-title">Can’t reach the InvestIQ server</p>
              <p className="muted small" title={state.error}>Your portfolio will appear as soon as the connection is back.</p>
              <button type="button" className="btn" onClick={retry}>Try again</button>
            </div>
          )}
          {live && state.status === 'live' && (
            <>
              {state.stream === 'closed' && (
                <p className="banner warn" role="alert">
                  Live updates stopped. <button type="button" className="link-btn" onClick={retry}>Reconnect</button>
                </p>
              )}
              {tab === 'dashboard'
                ? <Dashboard snapshot={state.snapshot} history={state.history} theme={theme} />
                : <HoldingsTable snapshot={state.snapshot} theme={theme} />}
            </>
          )}
        </main>
      </div>
    </AccountsContext.Provider>
  )
}

export default App
