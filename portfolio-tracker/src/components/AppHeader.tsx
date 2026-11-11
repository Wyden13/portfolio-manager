import { LayoutGroup, motion } from 'motion/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { LISTINGS } from '../demo/market'
import type { Profiles } from '../lib/holdings'
import { EASE_IN_OUT, move, spring } from '../lib/motion'
import { displaySymbol } from '../lib/portfolio'
import { hashFor, holdingHash, type Route } from '../lib/route'
import type { Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { BrandMark, Icon } from './Icon'
import { IconSwap } from './ui/IconSwap'
import { Popover } from './ui/Popover'

type NavId = 'portfolio' | 'markets' | 'accounts' | 'news'

const NAV: Array<[NavId, string, string]> = [
  ['portfolio', 'Portfolio', hashFor('portfolio')],
  ['markets', 'Markets', hashFor('markets')],
  ['accounts', 'Accounts', hashFor('accounts')],
  ['news', 'News', hashFor('news')],
]

/** Which nav item a page belongs under (the holding page sits under Markets, as in the design). */
function activeNav(route: Route): NavId | null {
  switch (route.tab) {
    case 'portfolio': case 'holdings': return 'portfolio'
    case 'markets': case 'holding': return 'markets'
    case 'accounts': return 'accounts'
    case 'news': return 'news'
    default: return null
  }
}

interface SearchHit { symbol: string; name: string; note: string }

function SearchBox({ snapshot, profiles }: { snapshot: PortfolioSnapshot | null; profiles: Profiles }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const index = useMemo(() => {
    const held = new Map<string, SearchHit>()
    for (const p of snapshot?.positions ?? []) {
      held.set(p.symbol, { symbol: p.symbol, name: profiles[p.symbol]?.name ?? LISTINGS.get(p.symbol)?.name ?? '', note: 'Held' })
    }
    const rest = [...LISTINGS.values()].filter((l) => !held.has(l.symbol)).map((l) => ({ symbol: l.symbol, name: l.name, note: l.exchange }))
    return [...held.values(), ...rest]
  }, [snapshot, profiles])

  const q = query.trim().toLowerCase()
  const hits = q
    ? index.filter((h) => displaySymbol(h.symbol).toLowerCase().startsWith(q) || h.name.toLowerCase().includes(q)).slice(0, 8)
    : []
  const close = useCallback(() => setOpen(false), [])
  const go = (hit: SearchHit) => {
    window.location.hash = holdingHash(hit.symbol)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="pop-wrap hide-m" ref={wrap}>
      <input className="srch" type="search" placeholder="Search symbols or companies" aria-label="Search symbols or companies"
        role="combobox" aria-expanded={open && hits.length > 0} aria-controls="search-results" aria-autocomplete="list"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter' && hits[active]) go(hits[active])
        }} />
      <Popover open={open && hits.length > 0} onClose={close} wrapRef={wrap} align="left" className="results" label="Search results">
        <div className="menu" role="listbox" id="search-results">
          {hits.map((h, i) => (
            <button key={h.symbol} type="button" role="option" aria-selected={i === active} className="menu-item"
              data-active={i === active ? '' : undefined} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
              <span className="sym">{displaySymbol(h.symbol)}</span>
              <span>{h.name}</span>
              <span className="m">{h.note}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}

const KNOB = {
  on: { x: 16, scaleX: [1, 1.12, 1] },
  off: { x: 0, scaleX: [1, 1.12, 1] },
}

function ThemeSwitch({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark'
  return (
    <button type="button" className="menu-item" role="menuitemcheckbox" aria-checked={dark} onClick={onToggle}>
      <IconSwap id={theme}><Icon name={dark ? 'moon' : 'sun'} /></IconSwap>
      <span className="grow">Dark theme</span>
      <span className="switch" aria-hidden="true" data-on={dark ? '' : undefined}>
        {/* The knob slides with ease-in-out and stretches 12% mid-travel. */}
        <motion.span className="knob" initial={false} variants={KNOB} animate={dark ? 'on' : 'off'}
          transition={{ duration: 0.24, ease: EASE_IN_OUT }} />
      </span>
    </button>
  )
}

function AccountMenu({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const link = (href: string, icon: Parameters<typeof Icon>[0]['name'], text: string) => (
    <a className="menu-item" role="menuitem" href={href} onClick={close}><Icon name={icon} />{text}</a>
  )
  return (
    <div className="pop-wrap" ref={wrap}>
      <button type="button" className="icon-btn avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="user" />
      </button>
      <Popover open={open} onClose={close} wrapRef={wrap} align="right" label="Account menu">
        <div className="menu" role="menu">
          <ThemeSwitch theme={theme} onToggle={onToggleTheme} />
          <div className="menu-sep" />
          {link(hashFor('accounts'), 'link', 'Linked institutions')}
          {link(hashFor('accounts', { view: 'history' }), 'list', 'Transaction history')}
          {link(hashFor('connect'), 'link', 'Connect an account')}
          <div className="menu-sep" />
          {link(hashFor('landing'), 'home', 'About InvestIQ')}
        </div>
      </Popover>
    </div>
  )
}

function MobileMenu({ current }: { current: NavId | null }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <div className="pop-wrap" ref={wrap}>
      <button type="button" className="icon-btn menu-btn" aria-label="Menu" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <IconSwap id={open ? 'close' : 'menu'}><Icon name={open ? 'close' : 'menu'} /></IconSwap>
      </button>
      <Popover open={open} onClose={close} wrapRef={wrap} align="left" label="Menu">
        <nav className="menu" aria-label="Main">
          {NAV.map(([id, label, href]) => (
            <a key={id} className="menu-item" href={href} aria-current={current === id ? 'page' : undefined}
              data-active={current === id ? '' : undefined} onClick={close}>{label}</a>
          ))}
        </nav>
      </Popover>
    </div>
  )
}

interface Props {
  route: Route
  theme: Theme
  onToggleTheme: () => void
  snapshot: PortfolioSnapshot | null
  profiles: Profiles
}

export function AppHeader({ route, theme, onToggleTheme, snapshot, profiles }: Props) {
  const current = activeNav(route)
  return (
    <header className="hdr-bar">
      <div className="wrap hdr">
        <MobileMenu current={current} />
        <a href={hashFor('portfolio')} className="logo"><BrandMark />InvestIQ</a>
        <LayoutGroup id="nav">
          <nav className="nav hide-m" aria-label="Main">
            {NAV.map(([id, label, href]) => (
              <motion.a key={id} href={href} aria-current={current === id ? 'page' : undefined} whileTap={{ scale: 0.97 }} transition={spring}>
                {/* The grey pill is one element that slides to the current page. */}
                {current === id && <motion.span layoutId="nav-pill" className="nav-pill" transition={move} />}
                <span className="lbl">{label}</span>
              </motion.a>
            ))}
          </nav>
        </LayoutGroup>
        <div className="hdr-right">
          <SearchBox snapshot={snapshot} profiles={profiles} />
          <a href={hashFor('connect')} className="btn connect-cta">Connect account</a>
          <AccountMenu theme={theme} onToggleTheme={onToggleTheme} />
        </div>
      </div>
    </header>
  )
}
