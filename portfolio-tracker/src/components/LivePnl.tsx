import { useMemo } from 'react'
import { BASE_KEY, type PnLHistory } from '../hooks/useLivePortfolio'
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

function rateLine(base: string, rates: Record<string, number>): string {
  return Object.entries(rates)
    .filter(([c]) => c !== base)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, r]) => `1 ${c} = ${r.toFixed(4)} ${base}`)
    .join(' · ')
}

interface Props {
  totals: CurrencyTotal[]
  baseTotal: CurrencyTotal | null
  fxRates: Record<string, number>
  history: PnLHistory
}

/** The converted grand total first (when every rate is known), then one card per currency. */
export function LivePnl({ totals, baseTotal, fxRates, history }: Props) {
  if (totals.length === 0) return null
  const showBase = baseTotal !== null && totals.length > 1
  const baseSamples = (history[BASE_KEY] ?? []).map((s) => s.pnl)
  return (
    <div className="cards">
      {showBase && (
        <article className={`card headline ${tone(baseTotal.unrealized_pnl)}`} aria-label={`Total portfolio in ${baseTotal.currency}`}>
          <h3>Total portfolio · {baseTotal.currency}</h3>
          <p className="big">{money(baseTotal.market_value, baseTotal.currency)}</p>
          <p className="delta">
            <span className="sr-only">Unrealized gain or loss </span>
            {signedMoney(baseTotal.unrealized_pnl, baseTotal.currency)} <span className="pct">{pct(baseTotal.unrealized_pct)}</span>
          </p>
          <p className="muted small">
            Cost basis {money(baseTotal.cost_basis, baseTotal.currency)}
            <span className="rates">{rateLine(baseTotal.currency, fxRates)}</span>
          </p>
          <Sparkline samples={baseSamples} label={`Total unrealized gain or loss, last ${baseSamples.length} updates`} />
        </article>
      )}
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
