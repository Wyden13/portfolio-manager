import { LayoutGroup, motion } from 'motion/react'
import { useId, useState } from 'react'
import { EASE_IN_OUT, move } from '../../lib/motion'

interface Props<T extends string> {
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  label: string
  /** Why an option can't be picked; it is shown disabled with this as its tooltip. */
  unavailable?: (option: T) => string | null
  size?: 'md' | 'lg'
}

/**
 * Range pills (the design's `.rng`). The soft accent fill is one shared layout element that slides
 * to the picked button (ease-in-out) and stretches 12% wide while it travels.
 */
export function RangeGroup<T extends string>({ value, options, onChange, label, unavailable, size = 'md' }: Props<T>) {
  const id = useId()
  // Only stretch after the user picked something, not when the group first appears.
  const [moved, setMoved] = useState(false)
  return (
    <LayoutGroup id={id}>
      <div className={`rng${size === 'lg' ? ' lg' : ''}`} role="group" aria-label={label}>
        {options.map((o) => {
          const why = unavailable?.(o) ?? null
          return (
            <button key={o} type="button" aria-pressed={o === value} disabled={why !== null} title={why ?? undefined}
              onClick={() => { setMoved(true); onChange(o) }}>
              {o === value && (
                <motion.span layoutId="fill" className="rng-fill" transition={move}>
                  <motion.span className="rng-fill" style={{ inset: 0 }}
                    initial={{ scaleX: 1 }}
                    animate={moved ? { scaleX: [1, 1.12, 1] } : undefined}
                    transition={{ duration: 0.32, ease: EASE_IN_OUT, times: [0, 0.5, 1] }} />
                </motion.span>
              )}
              <span className="lbl">{o}</span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
