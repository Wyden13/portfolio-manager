import { useAnimate } from 'motion/react'
import { useCallback } from 'react'
import { EASE_OUT } from '../lib/motion'

/** A short pulse (slight scale and a fading ring in the gain colour) to confirm something worked. */
export function usePulse<T extends HTMLElement>() {
  const [scope, animate] = useAnimate<T>()
  const pulse = useCallback(() => {
    const el = scope.current
    if (!el) return
    const color = getComputedStyle(el).getPropertyValue('--up').trim() || '#0A7A3D'
    void animate(el, {
      scale: [1, 1.04, 1],
      boxShadow: [`0 0 0 0px ${color}88`, `0 0 0 8px ${color}00`],
    }, { duration: 0.5, ease: EASE_OUT })
  }, [animate, scope])
  return [scope, pulse] as const
}
