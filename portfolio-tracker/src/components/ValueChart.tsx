import { useMemo, useState } from 'react'
import { fetchValueHistory } from '../api/client'
import { useAsync } from '../hooks/useAsync'
import { compactMoney, money } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { HistoryRange } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel, Segmented } from './Panel'

const RANGES: readonly HistoryRange[] = ['1M', '3M', '6M', '1Y']
const HEIGHT = 300

interface Props { currency: string; theme: Theme }

export function ValuePanel({ currency, theme }: Props) {
  const [range, setRange] = useState<HistoryRange>('3M')
  const history = useAsync(`${currency}|${range}`, (signal) => fetchValueHistory(currency, range, signal))
  const points = history.status === 'ready' ? history.data.points : null

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        valueFormatter: (v: number) => money(v, currency),
      },
      xAxis: {
        type: 'time', splitNumber: 5,
        axisLabel: { color: p.muted, hideOverlap: true, formatter: { year: '{yyyy}', month: '{MMM}', day: '{MMM} {d}' } },
        axisLine: { lineStyle: { color: p.grid } }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true, splitNumber: 4, splitLine: { lineStyle: { color: p.grid } },
        axisLabel: { color: p.muted, formatter: (v: number) => compactMoney(v, currency) },
      },
      series: [{
        type: 'line', name: 'Market value', showSymbol: false,
        lineStyle: { color: p.accent, width: 2 },
        areaStyle: { color: p.accent, opacity: 0.12 },
        data: (points ?? []).map((pt) => [pt.time * 1000, pt.value]),
      }],
    }
  }, [points, currency, theme])

  return (
    <Panel
      title="Portfolio value" className="span-6"
      controls={<Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />}
    >
      {history.status === 'loading' ? <Empty height={HEIGHT}>Loading…</Empty>
        : history.status === 'error' ? <Empty height={HEIGHT} tone="error">Value history is unavailable right now.</Empty>
        : history.data.points.length === 0 ? <Empty height={HEIGHT}>No value history for this period.</Empty>
        : <EChart option={option} height={HEIGHT} label={`Area chart of ${currency} portfolio value over ${range}`} />}
    </Panel>
  )
}
