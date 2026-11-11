import { useState } from 'react'
import { faviconUrl, tickerMonogram } from '../lib/holdings'

/** The company's website icon, or the ticker's letters when there is none (or it fails to load). */
export function TickerLogo({ symbol, website }: { symbol: string; website: string | null | undefined }) {
  const url = faviconUrl(website)
  const [failed, setFailed] = useState<string | null>(null)
  if (url && failed !== url) {
    return (
      <img className="ticker-logo" src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
        onError={() => setFailed(url)} />
    )
  }
  return <span className="ticker-logo monogram" aria-hidden="true">{tickerMonogram(symbol)}</span>
}
