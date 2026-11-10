import { useMemo, useState } from 'react'
import { allocation, pricedIn, type AllocationBy } from '../lib/aggregate'
import { money } from '../lib/format'
import { PALETTES, type Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { EChart, type EChartOption } from './EChart'
import { Empty, Panel, Segmented } from './Panel'

const MAX_SLICES = 8

interface Props { snapshot: PortfolioSnapshot; currency: string; theme: Theme }

export function AllocationPanel({ snapshot, currency, theme }: Props) {
  const [by, setBy] = useState<AllocationBy>('holding')
  const slices = useMemo(() => {
    const all = allocation(pricedIn(snapshot, currency), by)
    if (all.length <= MAX_SLICES) return all
    const rest = all.slice(MAX_SLICES - 1)
    return [...all.slice(0, MAX_SLICES - 1), { name: 'Other', value: rest.reduce((a, s) => a + s.value, 0) }]
  }, [snapshot, currency, by])

  const option = useMemo<EChartOption>(() => {
    const p = PALETTES[theme]
    return {
      color: p.series,
      tooltip: {
        trigger: 'item', backgroundColor: p.surface, borderColor: p.grid, textStyle: { color: p.text },
        formatter: (i: { name: string; value: number; percent: number }) =>
          `<b>${i.name}</b><br/>${money(i.value, currency)} · ${i.percent.toFixed(1)}%`,
      },
      series: [{
        type: 'pie', radius: ['52%', '78%'], center: ['50%', '50%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: p.surface, borderWidth: 2 },
        label: { color: p.text, formatter: '{b}\n{d}%' },
        data: slices,
      }],
    }
  }, [slices, currency, theme])

  return (
    <Panel
      title="Allocation" className="span-4"
      controls={<Segmented label="Group allocation by" value={by} options={['holding', 'account'] as const} onChange={setBy} />}
    >
      {slices.length === 0 ? <Empty>No priced {currency} positions yet.</Empty> : (
        <EChart option={option} height={360} label={`Donut chart of ${currency} allocation by ${by}`} />
      )}
    </Panel>
  )
}
