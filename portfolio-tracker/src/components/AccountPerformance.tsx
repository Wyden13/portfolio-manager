import { useMemo, useState } from 'react'
import { fetchAccountValueHistory } from '../api/client'
import { useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { compactMoney, money } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { HistoryRange } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel, Segmented } from './Panel'

const RANGES: readonly HistoryRange[] = ['1M', '3M', '6M', '1Y', '5Y', 'ALL']
const RANGE_LABEL: Partial<Record<HistoryRange, string>> = { ALL: 'All' }
const HEIGHT = 340

interface Props {
  /** Changes when accounts are added or removed, so the history is fetched again. */
  accountsKey: string
  colorOf: (accountId: number) => string
  theme: Theme
}

/** Value of each account over time (holdings plus cash, today's spot FX), with the total dashed. */
export function AccountPerformancePanel({ accountsKey, colorOf, theme }: Props) {
  const [range, setRange] = useState<HistoryRange>('1Y')
  const { label } = useAccounts()
  const history = useAsync(`${accountsKey}|${range}`, (signal) => fetchAccountValueHistory(range, signal))
  const data = history.status === 'ready' ? history.data : null

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    const currency = data?.currency ?? ''
    const accounts = (data?.accounts ?? []).filter((a) => a.points.some((pt) => pt.value !== 0))
    return {
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      legend: {
        type: 'scroll', top: 0, left: 0, right: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4,
        textStyle: { color: p.muted }, pageTextStyle: { color: p.muted },
      },
      tooltip: {
        trigger: 'axis', order: 'valueDesc', backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
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
      series: [
        ...accounts.map((a) => ({
          type: 'line', name: label(a.account_id), showSymbol: false,
          lineStyle: { color: colorOf(a.account_id), width: 2 }, itemStyle: { color: colorOf(a.account_id) },
          data: a.points.map((pt) => [pt.time * 1000, pt.value]),
        })),
        ...(accounts.length > 1 ? [{
          type: 'line', name: 'Total', showSymbol: false,
          lineStyle: { color: p.text, width: 1.5, type: 'dashed' }, itemStyle: { color: p.text },
          data: (data?.total ?? []).map((pt) => [pt.time * 1000, pt.value]),
        }] : []),
      ],
    }
  }, [data, label, colorOf, theme])

  const empty = data !== null && !data.accounts.some((a) => a.points.length > 0)
  return (
    <Panel
      title="Account performance" className="span-6"
      controls={<Segmented label="Time range" value={range} options={RANGES} onChange={setRange} format={(r) => RANGE_LABEL[r] ?? r} />}
    >
      {history.status === 'loading' ? <Empty height={HEIGHT}>Loading…</Empty>
        : history.status === 'error' ? <Empty height={HEIGHT} tone="error">Account history is unavailable right now.</Empty>
        : empty ? <Empty height={HEIGHT}>No account history for this period.</Empty>
        : (
          <>
            <EChart option={option} height={HEIGHT} replaceSeries label={`Line chart of each account's value in ${data?.currency}, ${range} range`} />
            <p className="muted small chart-note">
              Holdings replayed through your synced trades, plus cash; other currencies at today’s exchange rate.
            </p>
          </>
        )}
    </Panel>
  )
}
