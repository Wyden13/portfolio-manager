import { useMemo } from 'react'

/** A tiny trend line of recent live samples; takes its colour from the surrounding text. */
export function Sparkline({ samples, label }: { samples: number[]; label: string }) {
  const path = useMemo(() => {
    if (samples.length < 2) return null
    const min = Math.min(...samples)
    const max = Math.max(...samples)
    const span = max - min || 1
    return samples
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (samples.length - 1)) * 100).toFixed(2)},${(26 - ((v - min) / span) * 24).toFixed(2)}`)
      .join(' ')
  }, [samples])

  // Keep the space reserved until there are two points to draw, so cards don't jump.
  if (!path) return <div className="spark" aria-hidden="true" />
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
