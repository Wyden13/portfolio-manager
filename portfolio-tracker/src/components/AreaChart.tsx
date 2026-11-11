import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { nearestIndex, plotSeries, tickIndices } from '../lib/chart'
import { num } from '../lib/format'
import { maskReveal } from '../lib/motion'

export interface Point { t: number; v: number }

interface Props {
  points: Point[]
  height: number
  /** Gain or loss colour for the line. */
  tone: 'up' | 'dn'
  label: string
  /** Formats a point's time for the axis, and for the tooltip unless `formatTip` is given. */
  formatTime: (t: number) => string
  formatTip?: (t: number) => string
  /** A dashed reference: the starting value (grey) or your average cost (accent). */
  reference?: { value: number; kind: 'base' | 'cost' }
  volume?: number[]
  /** Changes when the series is swapped (another range): the new line wipes in over the old one. */
  seriesKey: string
  digits?: number
  ticks?: number
}

const W = 800
const H = 220

/**
 * The design's line chart: 800 x 220 viewBox stretched to the box, value labels on the
 * right, time labels below. A new series reveals left to right through a mask while the old one
 * fades (both on screen at once). The crosshair follows the pointer with no easing.
 */
export function AreaChart({ points, height, tone, label, formatTime, formatTip = formatTime, reference, volume, seriesKey, digits = 2, ticks = 6 }: Props) {
  const plot = useMemo(() => plotSeries(points.map((p) => p.v), W, H), [points])
  const refY = reference ? plot.yOf(reference.value) : null
  const plotRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const onMove = (e: PointerEvent) => {
    const box = plotRef.current?.getBoundingClientRect()
    if (!box || points.length === 0) return
    setHover(nearestIndex((e.clientX - box.left) / box.width, points.length))
  }

  const hp = hover !== null && hover < points.length ? points[hover] : null
  const hx = hp ? (plot.xOf(hover!) / W) * 100 : 0
  const hy = hp ? (((plot.yOf(hp.v) ?? 0) / H) * 100) : 0
  const vmax = volume?.length ? Math.max(...volume) || 1 : 1

  return (
    <>
      <div className="chart" style={{ height, color: `var(--${tone})` }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <div className="chart-plot" ref={plotRef}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {plot.grid.map((g) => (
              <line key={g.label} x1="0" x2={W} y1={g.y} y2={g.y} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {refY !== null && (
              <line x1="0" x2={W} y1={refY} y2={refY} stroke={reference!.kind === 'cost' ? 'var(--acc)' : 'var(--ink3)'}
                strokeWidth="1" strokeDasharray={reference!.kind === 'cost' ? '4 4' : '2 4'} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          <AnimatePresence initial={true}>
            <motion.svg key={seriesKey} className="chart-layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
              role="img" aria-label={label} {...maskReveal}>
              <path d={plot.line} fill="none" stroke={`var(--${tone})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </motion.svg>
          </AnimatePresence>
          {hp && (
            <>
              <span className="chart-cross" style={{ left: `${hx}%` }} />
              <span className="chart-dot" style={{ left: `${hx}%`, top: `${hy}%` }} />
              <span className="chart-tip" style={{ left: `clamp(60px, ${hx}%, calc(100% - 60px))` }}>
                {num(hp.v, digits)} · {formatTip(hp.t)}
              </span>
            </>
          )}
        </div>
        {plot.grid.map((g) => <span key={g.label} className="chart-y m" style={{ top: `${g.pct}%` }}>{g.label}</span>)}
      </div>
      {volume && volume.length > 0 && (
        <svg className="chart-vol" viewBox={`0 0 ${volume.length * 10} 48`} preserveAspectRatio="none" role="img" aria-label="Volume">
          {volume.map((v, i) => {
            const h = (v / vmax) * 46
            return <rect key={i} x={i * 10 + 1.5} y={48 - h} width="7" height={h} fill={hover === i ? 'var(--ink3)' : 'var(--line2)'} />
          })}
        </svg>
      )}
      <div className="chart-x m">
        {tickIndices(points.length, ticks).map((i) => <span key={i}>{formatTime(points[i].t)}</span>)}
      </div>
    </>
  )
}
