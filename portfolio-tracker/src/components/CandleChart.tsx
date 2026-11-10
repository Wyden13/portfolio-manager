import {
  CandlestickSeries, ColorType, createChart, HistogramSeries,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { fetchHistory } from '../api/client'
import { PALETTES, type Theme } from '../lib/theme'
import type { HistoryInterval, HistoryRange, HistoryResponse } from '../types'
import { Empty, Panel, Segmented } from './Panel'

const RANGES: readonly HistoryRange[] = ['1M', '3M', '6M', '1Y']
const INTERVALS: readonly HistoryInterval[] = ['1d', '1wk']

interface Props { symbols: string[]; theme: Theme }

export function CandlePanel({ symbols, theme }: Props) {
  const [symbol, setSymbol] = useState<string | null>(null)
  const [range, setRange] = useState<HistoryRange>('6M')
  const [interval, setInterval_] = useState<HistoryInterval>('1d')
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fall back to the first holding until the user picks one, and when the picked one disappears.
  const active = symbol && symbols.includes(symbol) ? symbol : symbols[0] ?? null

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    fetchHistory(active, range, interval, controller.signal)
      .then((d) => { setData(d); setError(null) })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [active, range, interval])

  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const c = createChart(el, { autoSize: true, height: 380 })
    candles.current = c.addSeries(CandlestickSeries, { borderVisible: false })
    volume.current = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' })
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    candles.current.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } })
    chart.current = c
    return () => {
      c.remove()
      chart.current = candles.current = volume.current = null
    }
  }, [])

  useEffect(() => {
    const p = PALETTES[theme]
    chart.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: p.surface }, textColor: p.muted },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.grid },
      timeScale: { borderColor: p.grid },
    })
    candles.current?.applyOptions({
      upColor: p.candleUp, downColor: p.candleDown, wickUpColor: p.candleUp, wickDownColor: p.candleDown,
    })
  }, [theme])

  useEffect(() => {
    if (!data) return
    const p = PALETTES[theme]
    candles.current?.setData(data.candles.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    volume.current?.setData(data.candles.map((c) => ({
      time: c.time as UTCTimestamp, value: c.volume,
      color: (c.close >= c.open ? p.candleUp : p.candleDown) + '88',
    })))
    chart.current?.timeScale().fitContent()
  }, [data, theme])

  return (
    <Panel
      title="Price history" className="span-12"
      note="Sample OHLC data — the backend has no history endpoint yet."
      controls={
        <>
          <label className="select">
            <span className="sr-only">Ticker</span>
            <select value={active ?? ''} onChange={(e) => setSymbol(e.target.value)} disabled={!active}>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
          <Segmented label="Candle interval" value={interval} options={INTERVALS} onChange={setInterval_} />
        </>
      }
    >
      {!active && <Empty>Add a holding to see its price history.</Empty>}
      {error && <Empty>Couldn’t load history: {error}</Empty>}
      <div
        ref={host} role="img" hidden={!active}
        aria-label={`Candlestick chart with volume for ${active ?? 'no ticker'}, ${range} range, ${interval} candles`}
      />
    </Panel>
  )
}
