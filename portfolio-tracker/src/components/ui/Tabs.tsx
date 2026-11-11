import { LayoutGroup, motion } from 'motion/react'
import { useId } from 'react'
import { move } from '../../lib/motion'

/** Underlined tabs; the underline is one element that slides between them. */
export function Tabs<T extends string>({ value, options, onChange, label }: {
  value: T; options: readonly T[]; onChange: (value: T) => void; label: string
}) {
  const id = useId()
  return (
    <LayoutGroup id={id}>
      <div className="tabs" role="tablist" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="tab" aria-selected={o === value} onClick={() => onChange(o)}>
            {o}
            {o === value && <motion.span layoutId="underline" className="tab-ul" transition={move} />}
          </button>
        ))}
      </div>
    </LayoutGroup>
  )
}
