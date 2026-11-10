import { useMemo } from 'react'
import type { PnLHistory } from '../hooks/useLivePortfolio'
import { money, pct, signedMoney, tone } from '../lib/format'
import type { CurrencyTotal } from '../types'

function Sparkline({ samples, label }: { samples: number[]; label: string }) {
  const path = useMemo(() => {
    if (samples.length < 2) return null
    const min = Math.min(...samples)
    const max = Math.max(...samples)
    const span = max - min || 1
    return samples
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (samples.length - 1)) * 100).toFixed(2)},${(26 - ((v - min) / span) * 24).toFixed(2)}`)
      .join(' ')
  }, [samples])

  // Keep the space reserved until there are two points to draw, so cards don't jump.
  if (!path) return <div className="spark" aria-hidden="true" />
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface Props { totals: CurrencyTotal[]; history: PnLHistory }

/** One card per currency: totals are never summed across currencies. */
export function LivePnl({ totals, history }: Props) {
  if (totals.length === 0) return null
  return (
    <div className="cards">
      {totals.map((t) => {
        const samples = (history[t.currency] ?? []).map((s) => s.pnl)
        return (
          <article key={t.currency} className={`card ${tone(t.unrealized_pnl)}`} aria-label={`${t.currency} holdings`}>
            <h3>{t.currency} holdings</h3>
            <p className="big">{money(t.market_value, t.currency)}</p>
            <p className="delta">
              <span className="sr-only">Unrealized gain or loss </span>
              {signedMoney(t.unrealized_pnl, t.currency)} <span className="pct">{pct(t.unrealized_pct)}</span>
            </p>
            <p className="muted small">Cost basis {money(t.cost_basis, t.currency)}</p>
            <Sparkline samples={samples} label={`${t.currency} unrealized gain or loss, last ${samples.length} updates`} />
          </article>
        )
      })}
    </div>
  )
}
