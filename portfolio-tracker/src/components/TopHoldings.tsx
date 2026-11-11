import { useMemo } from 'react'
import { useProfiles } from '../hooks/useProfiles'
import { money, pct, tone } from '../lib/format'
import { holdingRows, sortRows } from '../lib/holdings'
import { hashFor } from '../lib/route'
import type { PortfolioSnapshot } from '../types'
import { Panel } from './Panel'
import { TickerLogo } from './TickerLogo'

const TOP = 10

/** The largest holdings by value (all accounts together), linking to the full Holdings table. */
export function TopHoldings({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const profiles = useProfiles(snapshot)
  const rows = useMemo(
    () => sortRows(holdingRows(snapshot, profiles), 'marketValue', 'desc', snapshot.fx_rates).slice(0, TOP),
    [snapshot, profiles],
  )
  const total = new Set(snapshot.positions.map((p) => `${p.symbol}|${p.currency}`)).size
  if (rows.length === 0) return null

  return (
    <Panel
      title={`Top ${Math.min(TOP, total)} holdings`} className="span-12"
      controls={<a className="btn" href={hashFor('holdings')}>View all {total} holdings</a>}
    >
      <div className="table-wrap">
        <table className="holdings compact">
          <thead>
            <tr>
              <th scope="col">Ticker</th>
              <th scope="col">Company</th>
              <th scope="col" className="num">Weight</th>
              <th scope="col" className="num">Market value</th>
              <th scope="col" className="num">Change %</th>
              <th scope="col" className="num">P&amp;L %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="c-symbol">
                  <span className="ticker">
                    <TickerLogo symbol={r.symbol} website={r.profile?.website} />
                    <a href={hashFor('holdings', { symbol: r.symbol })}>{r.symbol}</a>
                  </span>
                </td>
                <td className="c-name" title={r.profile?.name ?? undefined}>{r.profile?.name ?? '—'}</td>
                <td className="num">{r.weight === null ? '—' : `${r.weight.toFixed(1)}%`}</td>
                <td className="num strong">{money(r.marketValue, r.currency)}</td>
                <td className={`num ${tone(r.dayChangePct)}`}>{pct(r.dayChangePct)}</td>
                <td className={`num ${tone(r.pnlPct)}`}>{pct(r.pnlPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
