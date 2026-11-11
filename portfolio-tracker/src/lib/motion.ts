import type { Transition } from 'motion/react'

/**
 * Motion tokens (mirrored as CSS variables in index.css):
 * ease-out for anything entering, ease-in-out for things moving on screen, exits 20% shorter than
 * entrances, and no bounce on everyday UI (springs always have bounce: 0).
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const

export const ENTER_S = 0.2
export const EXIT_S = ENTER_S * 0.8
/** Dropdowns and popovers sit in the 150-250ms band. */
export const POPOVER_S = 0.2
export const STAGGER_S = 0.03
/** Rows past this index appear with the last one; a long list must not keep trickling in. */
export const STAGGER_CAP = 12

export const enter: Transition = { duration: ENTER_S, ease: EASE_OUT }
export const exit: Transition = { duration: EXIT_S, ease: EASE_OUT }
export const move: Transition = { duration: 0.32, ease: EASE_IN_OUT }
export const spring: Transition = { type: 'spring', bounce: 0, duration: 0.35 }

/** Delay for the i-th item of a list that staggers in, 30ms apart. */
export const staggerDelay = (i: number, step = STAGGER_S) => Math.min(i, STAGGER_CAP) * step

/** Props for a table row or list item that fades up into place, staggered by its index. */
export function rowIn(i: number) {
  return {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { ...enter, delay: staggerDelay(i) },
  } as const
}

/** Icons swap by crossfading through a blur instead of popping. */
export const iconSwap = {
  initial: { opacity: 0, scale: 0.8, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: enter },
  exit: { opacity: 0, scale: 0.8, filter: 'blur(4px)', transition: exit },
} as const

/** Popovers grow from 0.95 out of their trigger and shrink back into it. */
export const popover = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: { duration: POPOVER_S, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: POPOVER_S * 0.8, ease: EASE_OUT } },
} as const

/** Left-to-right mask reveal for lines and fills. */
export const maskReveal = {
  initial: { clipPath: 'inset(0 100% 0 0)' },
  animate: { clipPath: 'inset(0 0% 0 0)', transition: { duration: 0.6, ease: EASE_OUT } },
  exit: { opacity: 0, transition: exit },
} as const

/** transform-origin pointing at the trigger, relative to the element that animates. */
export function originFrom(trigger: DOMRect | null, panel: DOMRect): string {
  if (!trigger) return 'center'
  const x = trigger.left + trigger.width / 2 - panel.left
  const y = trigger.top + trigger.height / 2 - panel.top
  return `${Math.round(x)}px ${Math.round(y)}px`
}
