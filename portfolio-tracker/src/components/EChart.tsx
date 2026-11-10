import { BarChart, LineChart, PieChart, TreemapChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([BarChart, LineChart, PieChart, TreemapChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer])

export type EChartOption = echarts.EChartsCoreOption

interface Props {
  option: EChartOption
  label: string
  height?: number
}

export function EChart({ option, label, height = 320 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const instance = echarts.init(el)
    chart.current = instance
    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, true)
  }, [option])

  return <div ref={ref} role="img" aria-label={label} style={{ width: '100%', height }} />
}
