import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { SampleTag } from '../components/ui/SampleTag'
import { RangeGroup } from '../components/ui/RangeGroup'
import { LISTINGS, SP500, TSX, type Exchange, type Listing } from '../demo/market'
import { ASSET_CLASS_LABEL } from '../lib/aggregate'
import { clock, shortDay } from '../lib/dates'
import { abbrev, dir, num, signedPct } from '../lib/format'
import { holdingRows, type Profiles } from '../lib/holdings'
import { EASE_OUT, enter, exit, rowIn, staggerDelay } from '../lib/motion'
import { displaySymbol, heatColor } from '../lib/portfolio'
import { holdingHash } from '../lib/route'
import { squarify } from '../lib/treemap'
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
const MAP_H = 520
const HEAD = 22

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
                          {!small && <span style={{ fontSize: size, fontWeight: 600 }}>{displaySymbol(t.symbol)}</span>}
                          {!small && th > 44 && <span style={{ fontSize: 11 }}>{signedPct(t.change)}</span>}
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
    <div className="tb" style={{ '--cols': '128px minmax(0, 1fr) 72px' } as CSSProperties}>
      {rows.map((s, i) => {
        const w = `${(Math.abs(s.change!) / max) * 100}%`
        return (
          <div key={s.name} className="tr" style={{ minHeight: 30 }}>
            <span>{s.name}</span>
            <span className="sbar">
              {/* Bars grow out from the zero line, one after another. */}
              <span>{s.change! < 0 && <motion.i style={{ width: w, background: 'var(--dn)', transformOrigin: 'right' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />}</span>
              <span>{s.change! > 0 && <motion.i style={{ width: w, background: 'var(--up)', transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ ...enter, duration: 0.4, delay: staggerDelay(i) }} />}</span>
            </span>
            <span className={dir(s.change)}>{signedPct(s.change)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Movers({ tiles, up }: { tiles: Tile[]; up: boolean }) {
  const rows = tiles.filter((t) => t.change !== null && (up ? t.change > 0 : t.change < 0))
    .sort((a, b) => (up ? b.change! - a.change! : a.change! - b.change!)).slice(0, 9)
  return (
    <div className="tb" style={{ '--cols': '72px minmax(0, 1fr) 80px 72px' } as CSSProperties}>
      <div className="tr th"><span>Symbol</span><span>Last</span><span>Change</span><span>Volume</span></div>
      {rows.length === 0 && <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>None today.</span></div>}
      {rows.map((t, i) => (
        <motion.div key={t.symbol} className="tr hv" {...rowIn(i)}>
          <span><a href={holdingHash(t.symbol)} className="sym">{displaySymbol(t.symbol)}</a></span>
          <span>{num(t.price)}</span>
          <span className={dir(t.change)}>{signedPct(t.change)}</span>
          <span className="m">{abbrev(t.volume)}</span>
        </motion.div>
      ))}
    </div>
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
    <section className="p c12" ref={ref} id="screener" style={{ scrollMarginTop: 16 }}>
      <div className="ph"><h2>Screener <SampleTag what="The screener" /></h2><span className="m" style={{ fontSize: 12 }}>{rows.length} results</span></div>
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
        <button type="button" className="btn o" style={{ marginLeft: 'auto' }} onClick={() => setS(ANY)}>Reset</button>
      </div>
      <div className="sx">
        <div className="tb" style={{ '--cols': '48px 72px minmax(200px, 1fr) 128px 96px 72px 80px 80px 80px 80px 88px', minWidth: 1100 } as CSSProperties}>
          <div className="tr th"><span>No.</span><span className="L">Ticker</span><span className="L">Company</span><span className="L">Sector</span><span>Mkt cap</span><span>P/E</span><span>Fwd P/E</span><span>Yield</span><span>Price</span><span>Change</span><span>Volume</span></div>
          {rows.length === 0 && <div className="tr"><span className="m" style={{ gridColumn: '1 / -1' }}>No listings match. Loosen a filter or reset.</span></div>}
          {rows.map((l, i) => (
            <motion.div key={`${key}:${l.symbol}`} className="tr hv" {...rowIn(i)}>
              <span className="m">{i + 1}</span>
              <span className="L"><a href={holdingHash(l.symbol)} className="sym">{displaySymbol(l.symbol)}</a></span>
              <span className="L">{l.name}</span>
              <span className="L m">{l.sector}</span>
              <span>{abbrev(l.cap)}</span><span>{num(l.pe, 1)}</span><span>{num(l.fpe, 1)}</span>
              <span>{num(l.yield, 1)}%</span><span>{num(l.price)}</span>
              <span className={dir(l.change)}>{signedPct(l.change)}</span>
              <span className="m">{abbrev(l.volume)}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Markets({ snapshot, profiles, params }: { snapshot: PortfolioSnapshot | null; profiles: Profiles; params: URLSearchParams }) {
  const [market, setMarket] = useState<Market>('S&P/TSX')
  const [mine, setMine] = useState(true)
  const tiles = useMemo(() => tilesFor(market, snapshot, profiles), [market, snapshot, profiles])
  const sectors = useMemo(() => sectorsOf(tiles), [tiles])
  const own = useMemo(() => new Set(snapshot?.positions.map((p) => p.symbol) ?? []), [snapshot])
  const sample = market !== 'Portfolio'
  const now = snapshot?.as_of ?? new Date().toISOString()
  const exchange = market === 'S&P 500' ? 'S&P 500' : 'TSX'

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <h1>Markets</h1>
          <span className="m">{market === 'Portfolio' ? 'Your holdings' : `${market} Composite`} · {shortDay(now)}, {clock(now)}{sample ? ' · sample figures' : ''}</span>
        </div>
        <div className="actions" style={{ gap: 16 }}>
          <label className="chk"><input type="checkbox" checked={mine} onChange={() => setMine((m) => !m)} />Outline my holdings</label>
          <RangeGroup label="Market" value={market} options={MARKETS} onChange={setMarket} size="lg" />
        </div>
      </div>

      <div className="grid">
        <section className="p c12">
          <div className="ph">
            <h2>Market map {sample && <SampleTag what="The market map" />}</h2>
            <div className="scale m" aria-label="Colour scale from −3% to +3%">
              <span>−3%</span>
              <span>{['n3', 'n2', 'n1', 'h0', 'h1', 'h2', 'h3'].map((c) => <i key={c} style={{ background: `var(--${c})` }} />)}</span>
              <span>+3%</span>
            </div>
          </div>
          {sectors.length ? <MarketMap sectors={sectors} own={own} mine={mine} mapKey={market} />
            : <div className="state" style={{ minHeight: 520 }}>{snapshot ? 'No priced holdings to map.' : 'Loading your holdings…'}</div>}
        </section>

        <section className="p c4">
          <div className="ph"><h2>Sectors {sample && <SampleTag what="Sector moves" />}</h2><span className="m" style={{ fontSize: 12 }}>Today</span></div>
          <SectorBars key={market} sectors={sectors} />
        </section>
        <section className="p c4">
          <div className="ph"><h2>Top gainers {sample && <SampleTag what="Movers" />}</h2><span className="m" style={{ fontSize: 12 }}>{market === 'Portfolio' ? 'Your holdings' : exchange}</span></div>
          <Movers key={market} tiles={tiles} up />
        </section>
        <section className="p c4">
          <div className="ph"><h2>Top losers {sample && <SampleTag what="Movers" />}</h2><span className="m" style={{ fontSize: 12 }}>{market === 'Portfolio' ? 'Your holdings' : exchange}</span></div>
          <Movers key={market} tiles={tiles} up={false} />
        </section>

        <Screener focus={params.get('view') === 'screener'} />
      </div>
    </>
  )
}
