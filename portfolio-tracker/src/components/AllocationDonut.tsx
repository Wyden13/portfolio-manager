import { useMemo } from 'react'
import { useAccounts } from '../hooks/useAccounts'
import { allocation, GROUP_LABEL, type AllocationBy } from '../lib/aggregate'
import { money } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty } from './Panel'

const MAX_SLICES = 8
const HEIGHT = 220

interface Props { snapshot: PortfolioSnapshot; by: AllocationBy; base: string; theme: Theme }

/** Donut of everything held (holdings and cash) in the base currency, with an HTML legend. */
export function AllocationDonut({ snapshot, by, base, theme }: Props) {
  const { label: accountLabel } = useAccounts()
  const slices = useMemo(() => {
    const all = allocation(snapshot, by, accountLabel)
    if (all.length <= MAX_SLICES) return all
    const rest = all.slice(MAX_SLICES - 1)
    return [...all.slice(0, MAX_SLICES - 1), { name: 'Other', value: rest.reduce((a, s) => a + s.value, 0) }]
  }, [snapshot, by, accountLabel])
  const total = slices.reduce((a, s) => a + s.value, 0)

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      color: p.series,
      tooltip: {
        trigger: 'item', backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        formatter: (i: { name: string; value: number; percent: number }) =>
          `<b>${i.name}</b><br/>${money(i.value, base)} · ${i.percent.toFixed(1)}%`,
      },
      series: [{
        type: 'pie', radius: ['58%', '88%'], center: ['50%', '50%'],
        itemStyle: { borderColor: p.surface, borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: {
          scale: true, scaleSize: 4,
          label: { show: true, color: p.text, fontSize: 14, fontWeight: 600, formatter: '{b}\n{d}%' },
        },
        data: slices,
      }],
    }
  }, [slices, base, theme])

  if (slices.length === 0) return <Empty height={HEIGHT}>Nothing with a live price to allocate yet.</Empty>
  return (
    <>
      <EChart option={option} height={HEIGHT} label={`Donut chart of ${base} allocation by ${GROUP_LABEL[by].toLowerCase()}`} />
      {/* An HTML legend instead of outer labels: those collide and get hidden on small slices. */}
      <ul className="legend">
        {slices.map((s, i) => (
          <li key={s.name}>
            <span className="swatch" style={{ background: PALETTES[theme].series[i % PALETTES[theme].series.length] }} />
            <span className="legend-name" title={s.name}>{s.name}</span>
            <span className="legend-value">{total ? ((s.value / total) * 100).toFixed(1) : '0.0'}%</span>
          </li>
        ))}
      </ul>
    </>
  )
}
