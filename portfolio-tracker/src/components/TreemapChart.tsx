import { useMemo } from 'react'
import { pricedIn } from '../lib/aggregate'
import { money, pct, signedMoney } from '../lib/format'
import { PALETTES, tileColor, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel } from './Panel'

interface Props { snapshot: PortfolioSnapshot; currency: string; theme: Theme }

export function TreemapPanel({ snapshot, currency, theme }: Props) {
  const rows = useMemo(() => pricedIn(snapshot, currency), [snapshot, currency])

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      tooltip: {
        backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        formatter: (info: { data: { name: string; value: number; pnl: number; pct: number; account: number } }) => {
          const d = info.data
          return `<b>${d.name}</b> · Account ${d.account}<br/>Value ${money(d.value, currency)}<br/>` +
            `P&amp;L ${signedMoney(d.pnl, currency)} (${pct(d.pct)})`
        },
      },
      series: [{
        type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
        width: '100%', height: '100%', left: 0, top: 0, right: 0, bottom: 0,
        itemStyle: { borderColor: p.surface, borderWidth: 2, gapWidth: 2 },
        label: {
          show: true, color: '#fff', overflow: 'truncate', position: 'inside', fontWeight: 600,
          formatter: (info: { data: { name: string; pct: number } }) => `{s|${info.data.name}}\n{p|${pct(info.data.pct, 1)}}`,
          rich: { s: { fontSize: 14, fontWeight: 700, color: '#fff' }, p: { fontSize: 12, color: '#fff' } },
        },
        data: rows.map((r) => ({
          name: r.symbol, value: r.market_value, pnl: r.unrealized_pnl, pct: r.unrealized_pct, account: r.account_id,
          itemStyle: { color: tileColor(r.unrealized_pct) },
        })),
      }],
    }
  }, [rows, currency, theme])

  return (
    <Panel
      title="Portfolio map" className="span-8"
      note={`Tile size = market value, colour = unrealized gain/loss vs cost (${currency} positions only).`}
    >
      {rows.length === 0 ? <Empty>No priced {currency} positions yet.</Empty> : (
        <EChart option={option} height={360} label={`Treemap of ${rows.length} ${currency} positions sized by market value and coloured by unrealized return`} />
      )}
    </Panel>
  )
}
