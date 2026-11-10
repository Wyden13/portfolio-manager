import { useState } from 'react'
import { TOTAL_KEY, type PnLHistory } from '../hooks/useLivePortfolio'
import { GROUP_LABEL, GROUPINGS, type AllocationBy } from '../lib/aggregate'
import { money, pct, plural, signedMoney, tone } from '../lib/format'
import type { Theme } from '../lib/theme'
import type { PortfolioSnapshot } from '../types'
import { AllocationDonut } from './AllocationDonut'
import { Panel, Segmented } from './Panel'
import { Sparkline } from './Sparkline'

function rateLine(base: string, rates: Record<string, number>): string {
  return Object.entries(rates)
    .filter(([c]) => c !== base)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, r]) => `1 ${c} = ${r.toFixed(4)} ${base}`)
    .join(' · ')
}

interface Props { snapshot: PortfolioSnapshot; history: PnLHistory; base: string; theme: Theme }

/** Everything across connected accounts in the base currency, next to how it is allocated. */
export function TotalAssetsCard({ snapshot, history, base, theme }: Props) {
  const [by, setBy] = useState<AllocationBy>('class')
  const { accounts, total_assets_base: total, cash_base: cash, base_total: pnl } = snapshot
  const holdings = accounts.reduce((a, s) => a + s.market_value, 0)
  const estimated = accounts.some((a) => a.cash.some((c) => c.estimated))
  const samples = (history[TOTAL_KEY] ?? []).map((s) => s.value)
  const rates = rateLine(base, snapshot.fx_rates)

  return (
    <Panel
      title="Total assets" className="span-6 total-assets"
      controls={<Segmented label="Group allocation by" value={by} options={GROUPINGS} onChange={setBy} format={(g) => GROUP_LABEL[g]} />}
    >
      <div className="total-body">
        <div className={`total-summary ${tone(pnl?.unrealized_pnl)}`}>
          <p className="eyebrow">{plural(accounts.length, 'account', 'accounts')} · {base}</p>
          <p className="big">{money(total, base)}</p>
          {total === null && <p className="muted small">An exchange rate is missing, so the total can’t be added up right now.</p>}
          {pnl && (
            <p className="delta">
              <span className="sr-only">Unrealized gain or loss </span>
              {signedMoney(pnl.unrealized_pnl, base)} <span className="pct">{pct(pnl.unrealized_pct)}</span>
            </p>
          )}
          <dl className="split">
            <div><dt>Holdings</dt><dd>{money(total === null ? null : holdings, base)}</dd></div>
            <div>
              <dt>Cash{estimated && <span className="pill est" title="Worked out from the synced activity, which may not reach back to when an account was opened">est.</span>}</dt>
              <dd>{money(cash, base)}</dd>
            </div>
            {pnl && <div><dt>Cost basis</dt><dd>{money(pnl.cost_basis, base)}</dd></div>}
          </dl>
          <Sparkline samples={samples} label={`Total assets, last ${samples.length} live updates`} />
          {rates && <p className="muted rates">{rates}</p>}
        </div>
        <div className="total-allocation">
          <AllocationDonut snapshot={snapshot} by={by} base={base} theme={theme} />
        </div>
      </div>
    </Panel>
  )
}
