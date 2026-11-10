import {
  CandlestickSeries, ColorType, createChart, HistogramSeries,
  type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'
import { fetchHistory } from '../api/client'
import { useAsync } from '../hooks/useAsync'
import { PALETTES, type Theme } from '../lib/theme'
import type { Candle, HistoryInterval, HistoryRange } from '../types'
import { Empty, Panel, Segmented } from './Panel'

const RANGES: readonly HistoryRange[] = ['1M', '3M', '6M', '1Y']
const INTERVALS: readonly HistoryInterval[] = ['1d', '1wk']
const INTERVAL_LABEL: Record<HistoryInterval, string> = { '1d': 'Daily', '1wk': 'Weekly' }
const HEIGHT = 380
const NO_CANDLES: Candle[] = []

interface Props { symbols: string[]; theme: Theme }

export function CandlePanel({ symbols, theme }: Props) {
  const [symbol, setSymbol] = useState<string | null>(null)
  const [range, setRange] = useState<HistoryRange>('6M')
  const [interval, setInterval_] = useState<HistoryInterval>('1d')

  // Follow the first holding until the user picks one, and when the picked one disappears.
  const active = symbol && symbols.includes(symbol) ? symbol : symbols[0] ?? null
  const history = useAsync(`${active}|${range}|${interval}`, (signal) =>
    active ? fetchHistory(active, range, interval, signal) : Promise.resolve(null))
  const candleData = history.status === 'ready' ? history.data?.candles ?? NO_CANDLES : NO_CANDLES
  const showChart = history.status === 'ready' && candleData.length > 0

  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const c = createChart(el, { autoSize: true })
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
    const p = PALETTES[theme]
    candles.current?.setData(candleData.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    volume.current?.setData(candleData.map((c) => ({
      time: c.time as UTCTimestamp, value: c.volume,
      color: (c.close >= c.open ? p.candleUp : p.candleDown) + '66',
    })))
    chart.current?.timeScale().fitContent()
  }, [candleData, theme])

  return (
    <Panel
      title="Price history" className="span-12"
      controls={active && (
        <>
          <label className="select">
            <span className="sr-only">Ticker</span>
            <select value={active} onChange={(e) => setSymbol(e.target.value)}>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
          <Segmented label="Candle interval" value={interval} options={INTERVALS} onChange={setInterval_} format={(i) => INTERVAL_LABEL[i]} />
        </>
      )}
    >
      {!active ? <Empty height={HEIGHT}>No holdings to chart.</Empty>
        : history.status === 'loading' ? <Empty height={HEIGHT}>Loading…</Empty>
        : history.status === 'error' ? <Empty height={HEIGHT} tone="error">Price history for {active} is unavailable right now.</Empty>
        : !showChart && <Empty height={HEIGHT}>No price history for {active} in this period.</Empty>}
      {/* The chart stays mounted (it is expensive to rebuild) and is only hidden between loads. */}
      <div
        ref={host} role="img" hidden={!showChart} style={{ height: HEIGHT }}
        aria-label={`Candlestick chart with volume for ${active ?? 'no ticker'}, ${range} range, ${INTERVAL_LABEL[interval].toLowerCase()} candles`}
      />
    </Panel>
  )
}
