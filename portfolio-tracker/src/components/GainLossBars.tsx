import { useMemo } from 'react'
import { gainLossRanking, pricedIn } from '../lib/aggregate'
import { money, pct, signedMoney } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel } from './Panel'

interface Props { snapshot: PortfolioSnapshot; currency: string; theme: Theme }

export function GainLossPanel({ snapshot, currency, theme }: Props) {
  const rows = useMemo(() => gainLossRanking(pricedIn(snapshot, currency)), [snapshot, currency])

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        formatter: (items: Array<{ dataIndex: number }>) => {
          const r = rows[items[0].dataIndex]
          return `<b>${r.symbol}</b> · Account ${r.account_id}<br/>${signedMoney(r.unrealized_pnl, currency)} (${pct(r.unrealized_pct)})`
        },
      },
      xAxis: {
        type: 'category', data: rows.map((r) => r.symbol), axisLabel: { color: p.muted, rotate: rows.length > 8 ? 40 : 0 },
        axisLine: { lineStyle: { color: p.grid } },
      },
      yAxis: {
        type: 'value', axisLabel: { color: p.muted, formatter: (v: number) => money(v, currency).replace(/\.00$/, '') },
        splitLine: { lineStyle: { color: p.grid } },
      },
      series: [{
        type: 'bar', barMaxWidth: 36,
        data: rows.map((r) => ({ value: r.unrealized_pnl, itemStyle: { color: r.unrealized_pnl >= 0 ? p.gain : p.loss } })),
      }],
    }
  }, [rows, currency, theme])

  return (
    <Panel title="Gain / loss by position" className="span-6" note={`Unrealized P&L in ${currency}, worst to best.`}>
      {rows.length === 0 ? <Empty>No priced {currency} positions yet.</Empty> : (
        <EChart option={option} height={300} label={`Bar chart of unrealized P&L for ${rows.length} ${currency} positions`} />
      )}
    </Panel>
  )
}
