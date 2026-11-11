/** A 64 x 32 trend line for an index card, coloured by the move over the series. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const span = Math.max(...values) - lo || 1
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 62 + 1).toFixed(1)} ${(30 - ((v - lo) / span) * 28).toFixed(1)}`).join(' ')
  const tone = values.at(-1)! >= values[0] ? 'var(--up)' : 'var(--dn)'
  return (
    <svg viewBox="0 0 64 32" width="64" height="32" style={{ flex: 'none' }} aria-hidden="true">
      <path d={d} fill="none" stroke={tone} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
