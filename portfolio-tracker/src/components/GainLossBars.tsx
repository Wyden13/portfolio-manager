import { useMemo } from 'react'
import { gainLossRanking, pricedIn } from '../lib/aggregate'
import { compactMoney, pct, signedMoney } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel } from './Panel'

const ROW_HEIGHT = 30
const MIN_HEIGHT = 300

interface Props { snapshot: PortfolioSnapshot; currency: string; theme: Theme }

export function GainLossPanel({ snapshot, currency, theme }: Props) {
  // Ascending, so on a category y-axis (drawn bottom-up) the best performer sits on top.
  const rows = useMemo(() => gainLossRanking(pricedIn(snapshot, currency)), [snapshot, currency])
  const height = Math.max(MIN_HEIGHT, rows.length * ROW_HEIGHT + 40)

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        formatter: (items: Array<{ dataIndex: number }>) => {
          const r = rows[items[0].dataIndex]
          return `<b>${r.symbol}</b> · Account ${r.account_id}<br/>${signedMoney(r.unrealized_pnl, currency)} (${pct(r.unrealized_pct)})`
        },
      },
      // Horizontal bars: tickers stay readable at any width instead of being skipped or rotated.
      yAxis: {
        type: 'category', data: rows.map((r) => r.symbol),
        axisLabel: { color: p.text, interval: 0 }, axisTick: { show: false }, axisLine: { lineStyle: { color: p.grid } },
      },
      xAxis: {
        type: 'value', splitNumber: 4,
        axisLabel: { color: p.muted, hideOverlap: true, formatter: (v: number) => compactMoney(v, currency) },
        splitLine: { lineStyle: { color: p.grid } },
      },
      series: [{
        type: 'bar', barMaxWidth: 18,
        itemStyle: { borderRadius: 3 },
        data: rows.map((r) => ({ value: r.unrealized_pnl, itemStyle: { color: r.unrealized_pnl >= 0 ? p.gain : p.loss } })),
      }],
    }
  }, [rows, currency, theme])

  return (
    <Panel title="Gain / loss by holding" className="span-6">
      {rows.length === 0 ? <Empty height={MIN_HEIGHT}>No priced {currency} holdings.</Empty> : (
        <EChart option={option} height={height} label={`Bar chart of unrealized gain or loss for ${rows.length} ${currency} holdings`} />
      )}
    </Panel>
  )
}
