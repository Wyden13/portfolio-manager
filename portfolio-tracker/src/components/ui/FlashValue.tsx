import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { EASE_OUT } from '../../lib/motion'

/**
 * Wraps a live number. When it changes, a gain or loss tint wipes across it from the left (a mask,
 * not a colour tween) and fades.
 */
export function FlashValue({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  const [prev, setPrev] = useState(value)
  const [flash, setFlash] = useState<{ dir: 'up' | 'dn'; n: number } | null>(null)
  if (value !== prev) {
    setPrev(value)
    if (prev != null && value != null) setFlash({ dir: value > prev ? 'up' : 'dn', n: (flash?.n ?? 0) + 1 })
  }
  return (
    <span className="flash">
      {flash && (
        <motion.span key={flash.n} className="flash-ov" aria-hidden="true"
          style={{ background: `color-mix(in srgb, var(--${flash.dir}) 16%, transparent)` }}
          initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }}
          animate={{ clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)', 'inset(0 0% 0 0)'], opacity: [1, 1, 0] }}
          transition={{ duration: 1, times: [0, 0.3, 1], ease: EASE_OUT }} />
      )}
      {children}
    </span>
  )
}
