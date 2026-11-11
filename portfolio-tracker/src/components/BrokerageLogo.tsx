import { useState } from 'react'
import { initials } from '../lib/connections'

/** The brokerage's official logo, or its initials when there is none (or it fails to load). */
export function BrokerageLogo({ name, url, size = 'md' }: { name: string; url: string | null; size?: 'sm' | 'md' }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (url && failed !== url) {
    return (
      <img className={`broker-logo ${size}`} src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(url)} />
    )
  }
  return <span className={`broker-logo monogram ${size}`} aria-hidden="true">{initials(name)}</span>
}
