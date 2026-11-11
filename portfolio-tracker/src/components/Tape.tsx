import { motion } from 'motion/react'
import { useRef } from 'react'
import type { IndexRow } from '../hooks/useIndices'
import { dir, num, signed, signedPct } from '../lib/format'
import { SampleTag } from './ui/SampleTag'

/**
 * The index tape under the header. Drag it sideways when it overflows; it follows the pointer 1:1
 * and rubber-bands past either end instead of stopping dead.
 */
export function Tape({ rows }: { rows: IndexRow[] }) {
  const bounds = useRef<HTMLDivElement>(null)
  const shown = rows.filter((r) => r.tape)
  const sample = shown.some((r) => r.sample)
  return (
    <div className="bar">
      <div className="wrap tape-wrap" ref={bounds}>
        <motion.div className="tape" drag="x" dragConstraints={bounds} dragElastic={0.18} dragMomentum
          dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }} aria-label="Markets">
          {shown.map((r) => (
            <span key={r.name} title={r.sample ? `${r.name}: sample figure` : r.name}>
              <b>{r.tape}</b>{num(r.last, r.digits)}{' '}
              <span className={dir(r.change)}>{r.absolute ? signed(r.change, 3) : signedPct(r.change)}</span>
            </span>
          ))}
          {sample && <SampleTag what="Part of the tape" />}
        </motion.div>
      </div>
    </div>
  )
}
