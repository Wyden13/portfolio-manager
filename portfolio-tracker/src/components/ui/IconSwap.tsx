import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { iconSwap } from '../../lib/motion'

/** Shows `children` for `id`; when `id` changes the old icon blurs out as the new one blurs in. */
export function IconSwap({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className="swap">
      <AnimatePresence initial={false}>
        <motion.span key={id} className="swap" {...iconSwap}>{children}</motion.span>
      </AnimatePresence>
    </span>
  )
}
