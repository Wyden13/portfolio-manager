import { fetchBrokerages } from '../api/client'
import { useAccounts } from '../hooks/useAccounts'
import { useAsync } from '../hooks/useAsync'
import { money, pct, plural, signedMoney, tone } from '../lib/format'
import type { AccountSummary } from '../types'
import { BrokerageLogo } from './BrokerageLogo'

const ESTIMATED_NOTE = 'Worked out from the synced activity, which may not reach back to when this account was opened'

interface Props {
  accounts: AccountSummary[]
  base: string
  /** All accounts together, for each one's share; null when it couldn't be added up. */
  totalAssets: number | null
  colorOf: (accountId: number) => string
}

/** One card per account, biggest first: value, unrealized P&L, holdings and computed cash. */
export function AccountCards({ accounts, base, totalAssets, colorOf }: Props) {
  const { get, label } = useAccounts()
  // Logos are a nicety: without them (or SnapTrade) the cards fall back to initials.
  const catalog = useAsync('brokerages', fetchBrokerages)
  const logos = catalog.status === 'ready' ? catalog.data.institution_logos : {}
  const sorted = [...accounts].sort((a, b) => b.total - a.total)

  return (
    <section className="account-grid" aria-label="Accounts">
      {sorted.map((a) => {
        const info = get(a.account_id)
        const institution = info?.institution ?? 'Account'
        const costed = a.cost_basis > 0
        return (
          <article key={a.account_id} className={`card account-card ${costed ? tone(a.unrealized_pnl) : 'flat'}`} aria-label={label(a.account_id)}>
            <header className="account-head">
              <BrokerageLogo name={institution} url={logos[institution] ?? null} />
              <div className="account-title">
                <h3>
                  <span className="swatch" style={{ background: colorOf(a.account_id) }} aria-hidden="true" />
                  {info ? `${info.account_type} ${info.account_number}` : `Account ${a.account_id}`}
                </h3>
                <p className="muted small">{institution}</p>
              </div>
              {totalAssets ? <span className="share muted small" title="Share of total assets">{((a.total / totalAssets) * 100).toFixed(1)}%</span> : null}
            </header>
            <p className="big">{money(a.total, base)}</p>
            <p className="delta">
              <span className="sr-only">Unrealized gain or loss </span>
              {costed ? <>{signedMoney(a.unrealized_pnl, base)} <span className="pct">{pct(a.unrealized_pct)}</span></> : <span className="muted">No cost basis</span>}
            </p>
            <dl className="split">
              <div><dt>Holdings</dt><dd>{money(a.market_value, base)} <span className="muted">· {plural(a.holdings, 'position', 'positions')}</span></dd></div>
              {a.cash.length === 0 ? <div><dt>Cash</dt><dd>{money(0, base)}</dd></div> : a.cash.map((c) => (
                <div key={c.currency}>
                  <dt>Cash {c.currency}{c.estimated && <span className="pill est" title={ESTIMATED_NOTE}>est.</span>}</dt>
                  <dd className={c.amount < 0 ? 'loss' : undefined}>{money(c.amount, c.currency)}</dd>
                </div>
              ))}
            </dl>
            {!a.complete && <p className="muted small">Some amounts are left out: an exchange rate is missing.</p>}
          </article>
        )
      })}
    </section>
  )
}
