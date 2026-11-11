import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { HoldingsTable } from './components/HoldingsTable'
import { LiveGate, NoAccounts } from './components/LiveGate'
import { Tape } from './components/Tape'
import { AccountsContext, useAccountsLoader } from './hooks/useAccounts'
import { ConnectionsContext, useConnectionsLoader } from './hooks/useConnections'
import { useRoute } from './hooks/useHashTab'
import { useIndices } from './hooks/useIndices'
import { useLivePortfolio } from './hooks/useLivePortfolio'
import { useProfiles } from './hooks/useProfiles'
import { useTheme } from './hooks/useTheme'
import { enter, exit } from './lib/motion'
import { hashFor } from './lib/route'
import { Accounts } from './pages/Accounts'
import { Connect } from './pages/Connect'
import { Holding } from './pages/Holding'
import { Landing } from './pages/Landing'
import { Markets } from './pages/Markets'
import { News } from './pages/News'
import { Portfolio } from './pages/Portfolio'
import './App.css'

function App() {
  const [theme, toggleTheme] = useTheme()
  const [route] = useRoute()
  const { state, retry } = useLivePortfolio()
  // Reload account names once the server is reachable (they label tables and filters).
  const accounts = useAccountsLoader(state.status === 'live' ? 1 : 0)
  const connections = useConnectionsLoader(accounts.reload)
  const snapshot = state.status === 'live' ? state.snapshot : null
  const profiles = useProfiles(snapshot)
  const indices = useIndices()

  // Opening the site at its root shows the landing page, unless a brokerage is already linked:
  // then it goes straight to the portfolio. Only on the first load, so the landing stays reachable.
  const [openedAtRoot] = useState(route.tab === 'landing')
  const redirected = useRef(false)
  const { overview } = connections
  useEffect(() => {
    if (!openedAtRoot || redirected.current || !overview) return
    redirected.current = true
    if (overview.connections.length > 0 && window.location.hash.replace(/^#\/?$/, '') === '') {
      window.location.replace(hashFor('portfolio'))
    }
  }, [openedAtRoot, overview])

  // Scroll to the top when the page (not just its query) changes.
  const pageKey = `${route.tab}:${route.params.get('symbol') ?? ''}:${route.params.get('view') ?? ''}`
  useEffect(() => { window.scrollTo({ top: 0 }) }, [route.tab, route.params])

  const live = (render: Parameters<typeof LiveGate>[0]['children']) => <LiveGate state={state} retry={retry}>{render}</LiveGate>
  const symbol = route.params.get('symbol')

  let page
  switch (route.tab) {
    case 'portfolio':
      page = live((s, h) => <Portfolio snapshot={s} history={h} profiles={profiles} stream={state.status === 'live' ? state.stream : 'closed'} />)
      break
    case 'holdings':
      page = live((s) => s.positions.length === 0 ? <NoAccounts /> : (
        <>
          <nav className="crumb m" aria-label="Breadcrumb"><a href={hashFor('portfolio')}>Portfolio</a><span>/</span><span style={{ color: 'var(--ink)' }}>Holdings</span></nav>
          <HoldingsTable snapshot={s} profiles={profiles} />
        </>
      ))
      break
    case 'accounts':
      page = live((s) => <Accounts snapshot={s} profiles={profiles} params={route.params} />)
      break
    case 'holding':
      page = symbol ? <Holding symbol={symbol} snapshot={snapshot} profiles={profiles} /> : <NoAccounts />
      break
    case 'markets':
      page = <Markets snapshot={snapshot} profiles={profiles} params={route.params} />
      break
    case 'news':
      page = <News snapshot={snapshot} indices={indices} />
      break
    case 'connect':
      page = <Connect snapshot={snapshot} params={route.params} />
      break
    default:
      page = null
  }

  return (
    <AccountsContext.Provider value={accounts}>
      <ConnectionsContext.Provider value={connections}>
        {route.tab === 'landing' ? <Landing /> : (
          <div className="app">
            <AppHeader route={route} theme={theme} onToggleTheme={toggleTheme} snapshot={snapshot} profiles={profiles} />
            <Tape rows={indices} />
            <LayoutGroup>
              {/* Pages cross over: the old one fades out while the new one comes in, both on screen at once. */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.main key={pageKey} className="wrap page"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: enter }} exit={{ opacity: 0, transition: exit }}>
                  {page}
                </motion.main>
              </AnimatePresence>
            </LayoutGroup>
          </div>
        )}
      </ConnectionsContext.Provider>
    </AccountsContext.Provider>
  )
}

export default App
