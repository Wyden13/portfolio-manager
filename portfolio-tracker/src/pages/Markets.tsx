import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Sparkline } from '../components/Sparkline'
import { SampleTag } from '../components/ui/SampleTag'
import { RangeGroup } from '../components/ui/RangeGroup'
import { LISTINGS, SP500, TSX, type Exchange, type Listing } from '../demo/market'
import { ASSET_CLASS_LABEL } from '../lib/aggregate'
import { clock, shortDay } from '../lib/dates'
import { abbrev, dir, num, plural, signed, signedPct } from '../lib/format'
import { holdingRows, type Profiles } from '../lib/holdings'
import { EASE_OUT, enter, exit, rowIn, staggerDelay } from '../lib/motion'
import { displaySymbol, heatColor } from '../lib/portfolio'
import { holdingHash } from '../lib/route'
import { squarify } from '../lib/treemap'
import type { IndexRow } from '../hooks/useIndices'
import type { PortfolioSnapshot } from '../types'

const MARKETS = ['S&P/TSX', 'S&P 500', 'Portfolio'] as const
type Market = typeof MARKETS[number]

interface Tile { symbol: string; weight: number; change: number | null; sector: string; price: number | null; volume: number | null }

const fromListing = (l: Listing): Tile => ({ symbol: l.symbol, weight: l.cap, change: l.change, sector: l.sector, price: l.price, volume: l.volume })

function tilesFor(market: Market, snapshot: PortfolioSnapshot | null, profiles: Profiles): Tile[] {
  if (market === 'S&P/TSX') return TSX.map(fromListing)
  if (market === 'S&P 500') return SP500.map(fromListing)
  if (!snapshot) return []
  return holdingRows(snapshot, profiles).map((r) => ({
    symbol: r.symbol, weight: r.valueBase ?? 0, change: r.dayChangePct,
    sector: r.profile?.sector ?? LISTINGS.get(r.symbol)?.sector ?? ASSET_CLASS_LABEL[r.assetClass],
    price: r.price, volume: r.volume,
  }))
}

interface Sector { name: string; weight: number; change: number | null; tiles: Tile[] }

/** Tiles grouped by sector; a sector's change is the weight-averaged change of its tiles. */
function sectorsOf(tiles: Tile[]): Sector[] {
  const by = new Map<string, Tile[]>()
  for (const t of tiles) if (t.weight > 0) by.set(t.sector, [...(by.get(t.sector) ?? []), t])
  return [...by].map(([name, ts]) => {
    const weight = ts.reduce((a, t) => a + t.weight, 0)
    const priced = ts.filter((t) => t.change !== null)
    const pw = priced.reduce((a, t) => a + t.weight, 0)
    return { name, weight, tiles: ts, change: pw ? priced.reduce((a, t) => a + t.weight * t.change!, 0) / pw : null }
  }).sort((a, b) => b.weight - a.weight)
}

const MAP_W = 1200
const MAP_H = 500
const HEAD = 24

function MarketMap({ sectors, own, mine, mapKey }: { sectors: Sector[]; own: Set<string>; mine: boolean; mapKey: string }) {
  const placed = squarify(sectors, (s) => s.weight, { x: 0, y: 0, w: MAP_W, h: MAP_H })
  return (
    <div className="sx">
      <div className="mmap">
        <AnimatePresence initial={false}>
          {/* The new map wipes in over the old one, which fades underneath (both on screen at once). */}
          <motion.div key={mapKey} style={{ position: 'absolute', inset: 0 }}
            initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)', transition: { duration: 0.5, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: exit }}>
            {placed.map(({ item: s, x, y, w, h }) => {
              const inner = squarify(s.tiles, (t) => t.weight, { x: 0, y: 0, w, h: Math.max(h - HEAD, 1) })
              return (
                <div key={s.name} className="mm-sec" style={{ left: `${(x / MAP_W) * 100}%`, top: `${(y / MAP_H) * 100}%`, width: `${(w / MAP_W) * 100}%`, height: `${(h / MAP_H) * 100}%` }}>
                  <div className="mm-head"><span>{s.name}</span><span className={dir(s.change)}>{signedPct(s.change)}</span></div>
                  <div className="mm-tiles">
                    {inner.map(({ item: t, x: tx, y: ty, w: tw, h: th }) => {
                      const { bg, fg } = heatColor(t.change)
                      const iw = Math.max(h - HEAD, 1)
                      const size = Math.max(11, Math.min(22, Math.sqrt(tw * th) / 5))
                      const small = tw < 44 || th < 30
                      return (
                        <a key={t.symbol} href={holdingHash(t.symbol)} className={`hm${mine && own.has(t.symbol) ? ' own' : ''}`}
                          title={`${displaySymbol(t.symbol)} ${signedPct(t.change)}`}
                          style={{ left: `${(tx / w) * 100}%`, top: `${(ty / iw) * 100}%`, width: `${(tw / w) * 100}%`, height: `${(th / iw) * 100}%`, background: bg, color: fg }}>
                          {!small && <span style={{ fontSize: size, fontWeight: 700 }}>{displaySymbol(t.symbol)}</span>}
                          {!small && th > 44 && <span style={{ fontSize: 11, fontWeight: 500 }}>{signedPct(t.change)}</span>}
                        </a>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function SectorBars({ sectors }: { sectors: Sector[] }) {
  const rows = [...sectors].filter((s) => s.change !== null).sort((a, b) => b.change! - a.change!)
  const max = Math.max(...rows.map((s) => Math.abs(s.change!)), 0.01)
  return (
    <div className="sec-rows">
      {rows.map((s, i) => {
        const w = `${(Math.abs(s.change!) / max) * 100}%`
        return (
          <div key={s.name} className="sec-row">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            <span className="sbar">
              {/* Bars grow out from the zero line, one after another. */}
              <span>{s.change! < 0 && <motion.i style={{ width: w, background: 'var(--dn)', transformOrigin: 'right' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />}</span>
              <span>{s.change! > 0 && <motion.i style={{ width: w, background: 'var(--up)', transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />}</span>
            </span>
            <span className={`b ${dir(s.change)}`}>{signedPct(s.change)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Movers({ tiles, up }: { tiles: Tile[]; up: boolean }) {
  const rows = tiles.filter((t) => t.change !== null && (up ? t.change > 0 : t.change < 0))
    .sort((a, b) => (up ? b.change! - a.change! : a.change! - b.change!)).slice(0, 6)
  return (
    <>
      {rows.length === 0 && <div className="li m"><span>None today.</span></div>}
      {rows.map((t, i) => (
        <motion.a key={t.symbol} href={holdingHash(t.symbol)} className="li" style={{ '--cols': 'minmax(0, 1fr) 80px 72px' } as CSSProperties}
          title={t.volume !== null ? `Volume ${abbrev(t.volume)}` : undefined} {...rowIn(i)}>
          <span className="b">{displaySymbol(t.symbol)}</span>
          <span className="m2">{num(t.price)}</span>
          <span className={`b ${dir(t.change)}`}>{signedPct(t.change)}</span>
        </motion.a>
      ))}
    </>
  )
}

interface Screen { exchange: Exchange | ''; cap: '' | 'large' | 'mid' | 'small'; sector: string; yld: '' | '2' | '4'; pe: '' | '15' | '20' }
const DEFAULT_SCREEN: Screen = { exchange: 'TSX', cap: 'large', sector: '', yld: '4', pe: '20' }
const ANY: Screen = { exchange: '', cap: '', sector: '', yld: '', pe: '' }

function screen(list: Listing[], s: Screen): Listing[] {
  return list.filter((l) =>
    (!s.exchange || l.exchange === s.exchange) &&
    (!s.cap || (s.cap === 'large' ? l.cap > 10e9 : s.cap === 'mid' ? l.cap >= 2e9 && l.cap <= 10e9 : l.cap < 2e9)) &&
    (!s.sector || l.sector === s.sector) &&
    (!s.yld || l.yield > Number(s.yld)) &&
    (!s.pe || (l.pe !== null && l.pe < Number(s.pe))),
  ).sort((a, b) => b.yield - a.yield)
}

function Screener({ focus }: { focus: boolean }) {
  const [s, setS] = useState<Screen>(DEFAULT_SCREEN)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])
  const all = [...TSX, ...SP500]
  const sectors = [...new Set(all.map((l) => l.sector))].sort()
  const rows = screen(all, s)
  const set = (patch: Partial<Screen>) => setS((x) => ({ ...x, ...patch }))
  const key = JSON.stringify(s)
  return (
    <section className="stack" ref={ref} id="screener" style={{ scrollMarginTop: 16 }}>
      <div className="sh"><h2>Screener <SampleTag what="The screener" /></h2><span className="m">{plural(rows.length, 'result', 'results')}</span></div>
      <div className="filters">
        <label className="sel">Exchange<select value={s.exchange} onChange={(e) => set({ exchange: e.target.value as Exchange | '' })}>
          <option value="">Any</option><option>TSX</option><option>NYSE</option><option>Nasdaq</option></select></label>
        <label className="sel">Market cap<select value={s.cap} onChange={(e) => set({ cap: e.target.value as Screen['cap'] })}>
          <option value="large">Large · over 10B</option><option value="mid">Mid · 2B to 10B</option><option value="small">Small · under 2B</option><option value="">Any</option></select></label>
        <label className="sel">Sector<select value={s.sector} onChange={(e) => set({ sector: e.target.value })}>
          <option value="">Any</option>{sectors.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="sel">Dividend yield<select value={s.yld} onChange={(e) => set({ yld: e.target.value as Screen['yld'] })}>
          <option value="4">Over 4%</option><option value="2">Over 2%</option><option value="">Any</option></select></label>
        <label className="sel">P/E<select value={s.pe} onChange={(e) => set({ pe: e.target.value as Screen['pe'] })}>
          <option value="20">Under 20</option><option value="15">Under 15</option><option value="">Any</option></select></label>
        <button type="button" className="link-btn" style={{ marginLeft: 'auto', height: 40, fontSize: 13 }} onClick={() => setS(ANY)}>Reset filters</button>
      </div>
      <div className="sx">
        <div className="tb tbC" style={{ '--cols': 'minmax(200px, 1fr) 100px 76px 56px 64px 80px 76px', minWidth: 760 } as CSSProperties}>
          <div className="tr th"><span>Company</span><span className="L">Sector</span><span>Mkt cap</span><span>P/E</span><span>Yield</span><span>Price</span><span>Today</span></div>
          {rows.length === 0 && <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>No listings match. Loosen a filter or reset.</span></div>}
          {rows.map((l, i) => (
            <motion.a key={`${key}:${l.symbol}`} href={holdingHash(l.symbol)} className="tr hv" {...rowIn(i)}>
              <span className="two"><span className="sym">{displaySymbol(l.symbol)}</span><span className="m small">{l.name}</span></span>
              <span className="L m2">{l.sector}</span>
              <span>{abbrev(l.cap)}</span><span>{num(l.pe, 1)}</span>
              <span className="b">{num(l.yield, 1)}%</span><span>{num(l.price)}</span>
              <span className={dir(l.change)}>{signedPct(l.change)}</span>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  )
}

const CARD_INDICES = ['^GSPTSE', '^GSPC', '^IXIC', '^DJI']

export function Markets({ snapshot, profiles, params, indices }: {
  snapshot: PortfolioSnapshot | null; profiles: Profiles; params: URLSearchParams; indices: IndexRow[]
}) {
  const [market, setMarket] = useState<Market>('S&P/TSX')
  const [mine, setMine] = useState(true)
  const tiles = useMemo(() => tilesFor(market, snapshot, profiles), [market, snapshot, profiles])
  const sectors = useMemo(() => sectorsOf(tiles), [tiles])
  const own = useMemo(() => new Set(snapshot?.positions.map((p) => p.symbol) ?? []), [snapshot])
  const sample = market !== 'Portfolio'
  const now = snapshot?.as_of ?? new Date().toISOString()
  const scope = market === 'Portfolio' ? 'Your holdings' : market === 'S&P 500' ? 'S&P 500' : 'TSX'
  const cards = indices.filter((r) => r.yahoo && CARD_INDICES.includes(r.yahoo))

  return (
    <div className="layout">
      <div className="main">
        <section className="stack s20">
          <div className="page-title">
            <h1 className="h1">Markets</h1>
            <span className="m">{shortDay(now)}, {clock(now)} · {market === 'Portfolio' ? 'your holdings' : `${market} Composite`}{sample ? ' · sample figures' : ''}</span>
          </div>
          <div className="idx">
            {cards.map((x, i) => (
              <motion.div key={x.name} className="card" {...rowIn(i)}>
                <span className="m2 small" style={{ fontWeight: 500, display: 'flex', justifyContent: 'space-between', gap: 8, whiteSpace: 'nowrap' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>{x.sample && <SampleTag what="This figure" />}
                </span>
                <div className="idx-row">
                  <div className="two">
                    <span className="b" style={{ fontSize: 18 }}>{num(x.last, x.digits)}</span>
                    <span className={`small ${dir(x.change)}`} style={{ fontWeight: 600 }}>{x.absolute ? signed(x.change, 3) : signedPct(x.change)}</span>
                  </div>
                  <Sparkline values={x.closes} />
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <div className="sh" style={{ alignItems: 'center' }}>
            <h2>Market map {sample && <SampleTag what="The market map" />}</h2>
            <div className="actions" style={{ gap: 16 }}>
              <label className="chk"><input type="checkbox" checked={mine} onChange={() => setMine((m) => !m)} />Outline my holdings</label>
              <RangeGroup label="Market" value={market} options={MARKETS} onChange={setMarket} />
            </div>
          </div>
          {sectors.length ? <MarketMap sectors={sectors} own={own} mine={mine} mapKey={market} />
            : <div className="state" style={{ minHeight: 500 }}>{snapshot ? 'No priced holdings to map.' : 'Loading your holdings…'}</div>}
          <div className="scale m" aria-label="Colour scale from −3% to +3%">
            <span>−3%</span>
            <span>{['n3', 'n2', 'n1', 'h0', 'h1', 'h2', 'h3'].map((c) => <i key={c} style={{ background: `var(--${c})` }} />)}</span>
            <span>+3%</span>
            <span className="hide-m" style={{ marginLeft: 'auto' }}>Size: {market === 'Portfolio' ? 'your value' : 'market cap'} · Colour: today’s change</span>
          </div>
        </section>

        <Screener focus={params.get('view') === 'screener'} />
      </div>

      <aside className="rail">
        <section className="card">
          <div className="ch"><h3>Sectors {sample && <SampleTag what="Sector moves" />}</h3><span className="m small">Today</span></div>
          <SectorBars key={market} sectors={sectors} />
        </section>
        <section className="card">
          <div className="ch"><h3>Top gainers · {scope} {sample && <SampleTag what="Movers" />}</h3></div>
          <Movers key={market} tiles={tiles} up />
        </section>
        <section className="card">
          <div className="ch"><h3>Top losers · {scope} {sample && <SampleTag what="Movers" />}</h3></div>
          <Movers key={market} tiles={tiles} up={false} />
        </section>
      </aside>
    </div>
  )
}
