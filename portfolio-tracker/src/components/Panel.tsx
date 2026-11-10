import type { ReactNode } from 'react'

interface Props {
  title: string
  className?: string
  controls?: ReactNode
  children: ReactNode
}

export function Panel({ title, className = '', controls, children }: Props) {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
        {controls && <div className="panel-controls">{controls}</div>}
      </header>
      {children}
    </section>
  )
}

/** Placeholder for loading, empty and error states. `height` matches the chart it stands in for. */
export function Empty({ children, height, tone }: { children: ReactNode; height?: number; tone?: 'error' }) {
  return (
    <div className={`state${tone ? ` ${tone}` : ''}`} role={tone === 'error' ? 'alert' : 'status'} style={{ minHeight: height }}>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({
  value, options, onChange, label, format,
}: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; format?: (v: T) => string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>{format ? format(o) : o}</button>
      ))}
    </div>
  )
}
