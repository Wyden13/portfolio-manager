import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { QUESTRADE_SIGN_IN_URL } from '../api/client'
import { BrokerageLogo } from '../components/BrokerageLogo'
import { Icon } from '../components/Icon'
import { errorText, useConnections } from '../hooks/useConnections'
import { usePulse } from '../hooks/usePulse'
import { outcomeOf, type InstitutionCard } from '../lib/connections'
import { dollars, plural } from '../lib/format'
import { EASE_IN_OUT, EASE_OUT, enter, exit, rowIn } from '../lib/motion'
import { hashFor } from '../lib/route'
import { LINK_CHANNEL } from '../lib/snaptradePortal'
import type { BrokerageId, BrokerageOption, PortfolioSnapshot } from '../types'

const STEPS = ['Institution', 'Sign in', 'Done'] as const
const SUPPORTS: Record<string, string> = {
  questrade: 'TFSA, RRSP, FHSA, margin',
  wealthsimple: 'TFSA, RRSP, FHSA, cash',
}
const NAME: Record<BrokerageId, string> = { questrade: 'Questrade', wealthsimple: 'Wealthsimple' }

/** The linked institution that a brokerage option became. */
function cardFor(option: BrokerageOption, cards: InstitutionCard[]): InstitutionCard | undefined {
  return option.id === 'questrade'
    ? cards.find((c) => c.platform === 'questrade')
    : cards.find((c) => c.platform === 'snaptrade' && c.name.toLowerCase().includes(option.name.toLowerCase()))
}

/** "Step 2 of 3" over three bars; each bar fills from the left as its step is reached. */
function Stepper({ step }: { step: number }) {
  return (
    <div className="steps">
      <span className="m small" style={{ fontWeight: 600 }}>Step {step} of 3 · {STEPS[step - 1]}</span>
      <div className="step-segs" aria-hidden="true">
        {STEPS.map((label, i) => (
          <span key={label} className="step-seg">
            {i + 1 <= step && (
              <motion.span className="step-bar" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }} />
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The chosen institution's logo travels from its row into the heading along a curve. */
function ArcLogo({ option, from }: { option: BrokerageOption; from: DOMRect | null }) {
  const [scope, animate] = useAnimate<HTMLSpanElement>()
  useLayoutEffect(() => {
    const el = scope.current
    if (!el || !from) return
    const to = el.getBoundingClientRect()
    const dx = from.left - to.left
    const dy = from.top - to.top
    // x eases in-out while y eases out: the two timings bend the straight path into an arc.
    void animate(el, { x: [dx, 0], y: [dy, 0] }, { x: { duration: 0.5, ease: EASE_IN_OUT }, y: { duration: 0.5, ease: EASE_OUT } })
  }, [animate, from, scope])
  return <span ref={scope} style={{ display: 'inline-flex' }}><BrokerageLogo name={option.name} url={option.logo_url} /></span>
}

function QuestradeSignIn({ oauth, onToken }: { oauth: boolean; onToken: (token: string) => Promise<void> }) {
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      {oauth && (
        <>
          <p className="m">You’ll sign in on Questrade’s own site and approve read-only access.</p>
          <a className="btn" href={QUESTRADE_SIGN_IN_URL} style={{ alignSelf: 'flex-start' }}>Sign in with Questrade</a>
        </>
      )}
      <details open={!oauth}>
        <summary>{oauth ? 'Use a personal App Hub token instead' : 'Connect with a personal App Hub token'}</summary>
        <form style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault()
            const value = token.trim()
            if (!value) return
            setPending(true)
            setError(null)
            onToken(value).catch((err: unknown) => setError(errorText(err))).finally(() => { setPending(false); setToken('') })
          }}>
          <label className="field">Refresh token
            <input type="password" autoComplete="off" spellCheck={false} value={token} required onChange={(e) => setToken(e.target.value)} />
          </label>
          <span className="m" style={{ fontSize: 13 }}>
            In Questrade, open App Hub, register a personal app and choose “Generate new token”. Each token works once;
            InvestIQ keeps the renewed one, encrypted.
          </span>
          {error && <span className="status-warn" role="alert">{error}</span>}
          <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }} disabled={pending || !token.trim()}>{pending ? 'Connecting…' : 'Connect'}</button>
        </form>
      </details>
    </>
  )
}

function SnapTradeSignIn({ option, onDone }: { option: BrokerageOption; onDone: () => void }) {
  const { connectSnapTrade } = useConnections()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <p>
        {option.name} has no public API, so you sign in on SnapTrade’s secure portal. You enter your {option.name} email,
        password and 2-step code there, never in InvestIQ, and InvestIQ gets read-only access.
      </p>
      {error && <span className="status-warn" role="alert">{error}</span>}
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} disabled={pending}
        onClick={() => {
          // Opened straight from the click so popup blockers allow the window.
          setPending(true)
          setError(null)
          connectSnapTrade(option)
            .then((r) => { if (r === 'closed') onDone() })
            .catch((e: unknown) => setError(errorText(e)))
            .finally(() => setPending(false))
        }}>
        {pending ? 'Waiting for SnapTrade…' : 'Continue to SnapTrade'}
      </button>
      {pending && <span className="m">Finish in the SnapTrade window. This updates when it closes.</span>}
    </>
  )
}

export function Connect({ snapshot, params }: { snapshot: PortfolioSnapshot | null; params: URLSearchParams }) {
  const { catalog, catalogError, cards, connectToken, sync, notice } = useConnections()
  // What a broker sign-in reported when it came back here (#/connections?linked=… from the backend).
  const [arrival] = useState(() => outcomeOf(params))
  const initial = params.get('institution') as BrokerageId | null
  const [step, setStep] = useState(arrival?.sync ? 3 : initial ? 2 : 1)
  const [chosen, setChosen] = useState<{ id: BrokerageId; from: DOMRect | null } | null>(
    arrival?.sync ? { id: arrival.sync === 'questrade' ? 'questrade' : 'wealthsimple', from: null } : initial ? { id: initial, from: null } : null,
  )
  const [linked, setLinked] = useState(false)
  const [query, setQuery] = useState('')
  const [doneRef, pulse] = usePulse<HTMLSpanElement>()

  // Report a finished link to the window that opened the portal and close this popup; when this is
  // not a popup (full-page sign-in, or the portal cut the opener off), sync right here.
  useEffect(() => {
    if (!arrival) return
    window.history.replaceState(null, '', hashFor('connect'))
    const platform = arrival.sync
    if (!platform) return
    const timer = window.setTimeout(() => {
      const channel = new BroadcastChannel(LINK_CHANNEL)
      channel.postMessage({ linked: platform })
      channel.close()
      if (window.opener) window.close()
      else void sync(platform, true)
    })
    return () => window.clearTimeout(timer)
  }, [arrival, sync])

  useEffect(() => {
    if (step === 3) pulse()
  }, [step, pulse])

  const option = chosen ? catalog?.options.find((o) => o.id === chosen.id) ?? null : null
  const card = option ? cardFor(option, cards) : undefined
  const accountTotal = (id: number) => snapshot?.accounts.find((a) => a.account_id === id)?.total ?? null
  const added = card?.accounts.reduce((a, x) => a + (accountTotal(x.id) ?? 0), 0) ?? 0
  const allAccounts = cards.reduce((a, c) => a + c.accounts.filter((x) => !x.duplicate && !x.removed).length, 0)

  const rows = [
    ...(catalog?.options ?? []).map((o) => ({ key: o.id, name: o.name, logo: o.logo_url, option: o, supports: SUPPORTS[o.id] ?? '',
      status: o.connected ? 'Connected' : !o.available ? 'Not set up' : '', disabled: !o.available || (o.id === 'questrade' && o.connected) })),
    ...cards.filter((c) => c.platform === 'snaptrade' && !(catalog?.options ?? []).some((o) => c.name.toLowerCase().includes(o.name.toLowerCase())))
      .map((c) => ({ key: c.name, name: c.name, logo: catalog?.institution_logos[c.name] ?? null, option: null, supports: 'Through SnapTrade', status: 'Connected', disabled: true })),
  ].filter((r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))

  const restart = () => { setStep(1); setChosen(null); setLinked(false) }
  const finishLink = () => setLinked(true)

  return (
    <div className="connect-page">
      <section className="card connect">
        <Stepper step={step} />
        {arrival?.tone === 'warn' && step === 1 && <p className="banner warn" role="alert" style={{ margin: '16px 24px 0' }}>{arrival.text}</p>}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0, transition: enter }} exit={{ opacity: 0, x: -12, transition: exit }}>
            {step === 1 && (
              <>
                <div className="connect-head">
                  <div className="two" style={{ gap: 4 }}>
                    <h1>Select your institution</h1>
                    <span className="m">Read-only access. InvestIQ can’t trade or move money.</span>
                  </div>
                  <input className="srch" style={{ width: '100%' }} type="search" placeholder="Search banks and brokerages"
                    aria-label="Search banks and brokerages" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="connect-list">
                  {!catalog && <div className="m" style={{ padding: 12 }}>{catalogError ? `Couldn’t load brokerages: ${catalogError}` : 'Loading brokerages…'}</div>}
                  {rows.map((r, i) => (
                    <motion.button key={r.key} type="button" className="instb" disabled={r.disabled} {...rowIn(i)}
                      onClick={(e) => {
                        if (!r.option) return
                        const logo = e.currentTarget.querySelector('.broker-logo')
                        setChosen({ id: r.option.id, from: logo?.getBoundingClientRect() ?? null })
                        setStep(2)
                      }}>
                      <BrokerageLogo name={r.name} url={r.logo} />
                      <span className="two" style={{ flex: 1 }}><span className="b">{r.name}</span><span className="m small">{r.supports}</span></span>
                      <span className="m small" style={{ fontWeight: 600 }}>{r.status}</span>
                    </motion.button>
                  ))}
                  {catalog && rows.length === 0 && <div className="m" style={{ padding: 12 }}>No institution matches “{query.trim()}”.</div>}
                </div>
                <div className="note">Other institutions can be added through SnapTrade.</div>
              </>
            )}

            {step === 2 && option && (
              <>
                <div className="connect-head">
                  <h1><ArcLogo option={option} from={chosen?.from ?? null} />{linked ? `${option.name} accounts found` : `Sign in to ${option.name}`}</h1>
                </div>
                <div className="connect-body">
                  {!linked && (option.id === 'questrade'
                    ? <QuestradeSignIn oauth={option.oauth ?? false} onToken={async (t) => { await connectToken(t); finishLink() }} />
                    : <SnapTradeSignIn option={option} onDone={finishLink} />)}
                  {linked && (
                    <span className="m">{card ? `${plural(card.accounts.length, 'account', 'accounts')} found. All of them are tracked; disconnect the institution to stop.` : 'Waiting for the first sync…'}</span>
                  )}
                </div>
                {linked && card && (
                  <div className="connect-body">
                    <div className="boxed">
                      {card.accounts.map((a, i) => (
                        <motion.div key={a.id} className="li" style={{ '--cols': '20px minmax(0, 1fr) auto' } as CSSProperties} {...rowIn(i)}>
                          <span className="up"><Icon name="check" size={14} /></span>
                          <span className="two L"><span className="b">{a.account_type || 'Account'}</span><span className="m small">{a.account_number}</span></span>
                          <span className="b">{dollars(accountTotal(a.id))}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
                {notice?.tone === 'warn' && <p className="banner warn" role="alert" style={{ margin: '0 24px' }}>{notice.text}</p>}
                <div className="connect-foot">
                  <button type="button" className="btn o" onClick={restart}>Back</button>
                  {linked && <button type="button" className="btn" onClick={() => setStep(3)}>Continue</button>}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="connect-head">
                  <h1>
                    <span className="done-check" ref={doneRef}><Icon name="check" /></span>
                    {option?.name ?? (chosen ? NAME[chosen.id] : 'Institution')} is connected
                  </h1>
                  <span className="m">
                    {card ? `${plural(card.accounts.length, 'account', 'accounts')} added. ` : ''}Positions are importing and will appear within a minute.
                  </span>
                </div>
                <div style={{ margin: '0 24px' }} className="boxed">
                  <div className="li"><span className="m2">Accounts linked</span><span className="b">{allAccounts}</span></div>
                  <div className="li"><span className="m2">Value added</span><span className="b">{dollars(added)}</span></div>
                  <div className="li tot"><span>New portfolio total</span><span>{dollars(snapshot?.total_assets_base)}</span></div>
                </div>
                <div className="connect-foot">
                  <button type="button" className="btn o" onClick={restart}>Connect another</button>
                  <a href={hashFor('portfolio')} className="btn">Go to portfolio</a>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  )
}
