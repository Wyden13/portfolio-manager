import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode, type RefObject } from 'react'
import { popover } from '../../lib/motion'

interface Props {
  open: boolean
  onClose: () => void
  /** The `.pop-wrap` holding the trigger and this popover; clicks inside it don't close it. */
  wrapRef: RefObject<HTMLElement | null>
  /** Which edge of the trigger the popover lines up with; it grows out of that corner. */
  align?: 'left' | 'right'
  className?: string
  label?: string
  children: ReactNode
}

/**
 * A panel under its trigger. Opens from 0.95 at the trigger's corner in 200ms and shrinks back
 * into it on close (exits 20% shorter). Closes on Escape or a click outside.
 */
export function Popover({ open, onClose, wrapRef, align = 'right', className = '', label, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, wrapRef])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className={`pop ${align} ${className}`} role="dialog" aria-label={label}
          style={{ transformOrigin: `top ${align}` }} {...popover}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
