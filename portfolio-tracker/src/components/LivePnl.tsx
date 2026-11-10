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

  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        : <line x1="0" x2="100" y1="14" y2="14" stroke="currentColor" strokeOpacity=".3" strokeDasharray="3 3" />}
    </svg>
  )
}

interface Props { totals: CurrencyTotal[]; history: PnLHistory }

/** One card per currency: totals are never summed across currencies. */
export function LivePnl({ totals, history }: Props) {
  if (totals.length === 0) return null
  return (
    <div className="cards" aria-live="off">
      {totals.map((t) => {
        const samples = (history[t.currency] ?? []).map((s) => s.pnl)
        const dir = tone(t.unrealized_pnl)
        return (
          <article key={t.currency} className={`card ${dir}`} aria-label={`${t.currency} live P&L`}>
            <h3>{t.currency} portfolio</h3>
            <p className="big">{money(t.market_value, t.currency)}</p>
            <p className="delta">
              <span className="sr-only">Unrealized P&L </span>
              {signedMoney(t.unrealized_pnl, t.currency)} <span className="pct">({pct(t.unrealized_pct)})</span>
            </p>
            <p className="muted small">Cost {money(t.cost_basis, t.currency)}</p>
            <Sparkline samples={samples} label={`${t.currency} unrealized P&L over the last ${samples.length} updates`} />
          </article>
        )
      })}
    </div>
  )
}
