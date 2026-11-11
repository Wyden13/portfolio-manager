import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { enter, exit, originFrom, popover } from '../../lib/motion'

interface Props {
  open: boolean
  onClose: () => void
  /** Where the button that opened it was: the panel grows out of it and shrinks back into it. */
  trigger: DOMRect | null
  labelledBy: string
  children: ReactNode
}

function Panel({ onClose, trigger, labelledBy, children }: Omit<Props, 'open'>) {
  const dialog = useRef<HTMLDialogElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Open before paint, then point the panel's transform-origin at the trigger.
  useLayoutEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    if (panel.current) panel.current.style.transformOrigin = originFrom(trigger, panel.current.getBoundingClientRect())
  }, [trigger])

  return (
    <dialog ref={dialog} className="modal" aria-labelledby={labelledBy}
      onCancel={(e) => { e.preventDefault(); onClose() }}>
      <motion.div className="modal-scrim" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1, transition: enter }} exit={{ opacity: 0, transition: exit }} />
      <motion.div ref={panel} className="modal-panel" {...popover}>
        {children}
      </motion.div>
    </dialog>
  )
}

/** A modal dialog (native <dialog>: focus trap, Escape) that animates in from its trigger and back out. */
export function Modal({ open, ...rest }: Props) {
  return <AnimatePresence>{open && <Panel {...rest} />}</AnimatePresence>
}
