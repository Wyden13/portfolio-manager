import { useMemo } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { costNote, holdingLabels, valuedIn } from '../lib/aggregate'
import { money, pct, signedMoney } from '../lib/format'
import { PALETTES, tileColor, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel } from './Panel'

const HEIGHT = 360
// Tiles below this share of the map are too small for a readable label (they keep their tooltip).
const MIN_LABEL_SHARE = { narrow: 0.04, wide: 0.008 }

interface Props { snapshot: PortfolioSnapshot; currency: string; theme: Theme }

export function TreemapPanel({ snapshot, currency, theme }: Props) {
  const rows = useMemo(() => valuedIn(snapshot, currency), [snapshot, currency])
  const { label: accountLabel, get: getAccount } = useAccounts()
  const labels = useMemo(() => holdingLabels(rows, getAccount), [rows, getAccount])

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    const total = rows.reduce((a, r) => a + r.market_value, 0)
    const minShare = window.matchMedia('(max-width: 640px)').matches ? MIN_LABEL_SHARE.narrow : MIN_LABEL_SHARE.wide
    return {
      tooltip: {
        backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        formatter: (info: { data: { name: string; value: number; pnl: number | null; pct: number | null; account: string; note: string } }) => {
          const d = info.data
          return `<b>${d.name}</b> · ${d.account}<br/>Value ${money(d.value, currency)}` +
            (d.pnl === null ? '' : `<br/>Unrealized ${signedMoney(d.pnl, currency)} (${pct(d.pct)})`) +
            (d.note ? `<br/><span style="opacity:.75">${d.note}</span>` : '')
        },
      },
      series: [{
        type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
        width: '100%', height: '100%', left: 0, top: 0, right: 0, bottom: 0,
        itemStyle: { borderColor: p.surface, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        label: {
          show: true, overflow: 'truncate', position: 'insideTopLeft', padding: [8, 10],
          formatter: (info: { data: { name: string; pct: number | null } }) =>
            info.data.pct === null ? `{s|${info.data.name}}` : `{s|${info.data.name}}\n{p|${pct(info.data.pct, 1)}}`,
          rich: {
            s: { fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 20 },
            p: { fontSize: 12, color: 'rgba(255,255,255,0.9)', lineHeight: 16 },
          },
        },
        upperLabel: { show: false },
        data: rows.map((r, i) => ({
          name: labels[i], value: r.market_value, pnl: r.unrealized_pnl, pct: r.unrealized_pct,
          account: accountLabel(r.account_id), note: costNote(r),
          itemStyle: { color: tileColor(r.unrealized_pct ?? 0) },
          label: { show: total > 0 && r.market_value / total >= minShare },
        })),
      }],
    }
  }, [rows, labels, currency, theme, accountLabel])

  return (
    <Panel title="Holdings map" className="span-8">
      {rows.length === 0 ? <Empty height={HEIGHT}>No {currency} holdings with a live price.</Empty> : (
        <EChart option={option} height={HEIGHT} label={`Treemap of ${rows.length} ${currency} holdings sized by market value and coloured by unrealized return`} />
      )}
    </Panel>
  )
}
