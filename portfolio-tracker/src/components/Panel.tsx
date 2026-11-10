import type { ReactNode } from 'react'

interface Props {
  title: string
  className?: string
  controls?: ReactNode
  note?: string
  children: ReactNode
}

export function Panel({ title, className = '', controls, note, children }: Props) {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
        {controls && <div className="panel-controls">{controls}</div>}
      </header>
      {note && <p className="panel-note">{note}</p>}
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state" role="status">{children}</div>
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  )
}
