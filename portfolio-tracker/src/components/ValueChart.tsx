import { useEffect, useMemo, useState } from 'react'
import { fetchValueHistory } from '../api/client'
import { totalFor } from '../lib/aggregate'
import { money } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { HistoryRange, PortfolioSnapshot, ValueHistoryResponse } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel, Segmented } from './Panel'

const RANGES: readonly HistoryRange[] = ['1M', '3M', '6M', '1Y']

interface Props { snapshot: PortfolioSnapshot; currency: string; theme: Theme }

export function ValuePanel({ snapshot, currency, theme }: Props) {
  const [range, setRange] = useState<HistoryRange>('3M')
  const [data, setData] = useState<ValueHistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The series is anchored to today's value; depend on the number, not the snapshot object, so a
  // 5s stream tick doesn't refetch the whole history.
  const current = Math.round(totalFor(snapshot, currency)?.market_value ?? 0)

  useEffect(() => {
    const controller = new AbortController()
    fetchValueHistory(currency, range, current, controller.signal)
      .then((d) => { setData(d); setError(null) })
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [currency, range, current])

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        valueFormatter: (v: number) => money(v, currency),
      },
      xAxis: { type: 'time', axisLabel: { color: p.muted }, axisLine: { lineStyle: { color: p.grid } } },
      yAxis: {
        type: 'value', scale: true, splitLine: { lineStyle: { color: p.grid } },
        axisLabel: { color: p.muted, formatter: (v: number) => money(v, currency).replace(/\.00$/, '') },
      },
      series: [{
        type: 'line', name: 'Market value', showSymbol: false, smooth: false,
        lineStyle: { color: p.accent, width: 2 },
        areaStyle: { color: p.accent, opacity: 0.14 },
        data: (data?.points ?? []).map((pt) => [pt.time * 1000, pt.value]),
      }],
    }
  }, [data, currency, theme])

  return (
    <Panel
      title="Portfolio value" className="span-6"
      note="Sample history — the backend has no value-over-time endpoint yet."
      controls={<Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />}
    >
      {error ? <Empty>Couldn’t load value history: {error}</Empty>
        : !data ? <Empty>Loading…</Empty>
        : <EChart option={option} height={300} label={`Area chart of ${currency} portfolio value over ${range}`} />}
    </Panel>
  )
}
