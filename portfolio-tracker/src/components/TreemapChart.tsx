import { useMemo } from 'react'
import { pricedIn } from '../lib/aggregate'
import { money, pct, signedMoney } from '../lib/format'
import { PALETTES, tileColor, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel } from './Panel'

const HEIGHT = 360

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
            `Unrealized ${signedMoney(d.pnl, currency)} (${pct(d.pct)})`
        },
      },
      series: [{
        type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
        width: '100%', height: '100%', left: 0, top: 0, right: 0, bottom: 0,
        itemStyle: { borderColor: p.surface, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        label: {
          show: true, overflow: 'truncate', position: 'insideTopLeft', padding: [8, 10],
          formatter: (info: { data: { name: string; pct: number } }) => `{s|${info.data.name}}\n{p|${pct(info.data.pct, 1)}}`,
          rich: {
            s: { fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 20 },
            p: { fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 16 },
          },
        },
        upperLabel: { show: false },
        data: rows.map((r) => ({
          name: r.symbol, value: r.market_value, pnl: r.unrealized_pnl, pct: r.unrealized_pct, account: r.account_id,
          itemStyle: { color: tileColor(r.unrealized_pct) },
        })),
      }],
    }
  }, [rows, currency, theme])

  return (
    <Panel title="Holdings map" className="span-8">
      {rows.length === 0 ? <Empty height={HEIGHT}>No priced {currency} holdings.</Empty> : (
        <EChart option={option} height={HEIGHT} label={`Treemap of ${rows.length} ${currency} holdings sized by market value and coloured by unrealized return`} />
      )}
    </Panel>
  )
}
