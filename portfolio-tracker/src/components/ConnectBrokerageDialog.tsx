import { useEffect, useRef, useState } from 'react'
import { QUESTRADE_SIGN_IN_URL } from '../api/client'
import type { BrokerageCatalog, BrokerageId, BrokerageOption } from '../types'
import { BrokerageLogo } from './BrokerageLogo'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

/** One Questrade connection per user: a linked Questrade is reconnected from its card instead. */
const selectable = (o: BrokerageOption) => o.available && !(o.id === 'questrade' && o.connected)

function Tile({ option, onSelect }: { option: BrokerageOption; onSelect: () => void }) {
  const note = !option.available ? 'Not set up on the server' : option.method === 'direct' ? 'Direct connection' : 'Through SnapTrade'
  return (
    <button type="button" className="broker-tile" disabled={!selectable(option)} onClick={onSelect}>
      <BrokerageLogo name={option.name} url={option.logo_url} size="lg" />
      <span className="broker-text">
        <span className="broker-name">{option.name}</span>
        <span className="muted small">{note}</span>
      </span>
      {option.connected && <span className="pill">Connected</span>}
    </button>
  )
}

function QuestradeSignIn({ oauth, pending, onToken }: { oauth: boolean; pending: boolean; onToken: (token: string) => void }) {
  const [token, setToken] = useState('')
  return (
    <div className="conn-signin">
      {oauth && (
        <>
          <p className="muted small">You’ll sign in on Questrade’s own site and approve read-only access.</p>
          <a className="btn primary" href={QUESTRADE_SIGN_IN_URL}>Sign in with Questrade</a>
        </>
      )}
      <details open={!oauth}>
        <summary>{oauth ? 'Use a personal App Hub token instead' : 'Connect with a personal App Hub token'}</summary>
        <form
          className="conn-token"
          onSubmit={(e) => {
            e.preventDefault()
            const value = token.trim()
            if (!value) return
            setToken('')
            onToken(value)
          }}
        >
          <label className="field">
            Refresh token
            <input type="password" autoComplete="off" spellCheck={false} value={token} required
              onChange={(e) => setToken(e.target.value)} />
          </label>
          <p className="muted small">
            In Questrade, open App Hub, register a personal app and choose “Generate new token”. Each token works once;
            InvestIQ keeps the renewed one, encrypted.
          </p>
          <button type="submit" className="btn primary" disabled={pending || !token.trim()}>
            {pending ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </details>
    </div>
  )
}

interface Props {
  /** null while the brokerage list loads. */
  catalog: BrokerageCatalog | null
  catalogError: string | null
  /** Open straight at this brokerage's sign-in (reconnecting). */
  initial?: BrokerageId
  onToken: (token: string) => Promise<void>
  onSnapTrade: (option: BrokerageOption) => Promise<void>
  onClose: () => void
}

/** "Connect a brokerage": pick one, then fill in what that brokerage needs. */
export function ConnectBrokerageDialog({ catalog, catalogError, initial, onToken, onSnapTrade, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<BrokerageId | null>(initial ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const option = catalog?.options.find((o) => o.id === selected) ?? null

  // Runs `action` synchronously up to its first await, so a popup it opens still counts as user-initiated.
  const submit = async (action: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPending(false)
    }
  }
  const back = () => {
    setSelected(null)
    setError(null)
  }
  const close = (
    <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><CloseIcon /></button>
  )

  return (
    <dialog ref={ref} className="dialog connect-dialog" aria-labelledby="connect-title"
      onCancel={(e) => { e.preventDefault(); onClose() }}>
      {!option ? (
        <>
          <header className="dialog-head">
            <h2 id="connect-title">Connect a brokerage</h2>
            {close}
          </header>
          <p className="muted small">Choose where your account is. InvestIQ only reads your holdings and transactions.</p>
          {catalog ? (
            <div className="broker-tiles">
              {catalog.options.map((o) => <Tile key={o.id} option={o} onSelect={() => setSelected(o.id)} />)}
            </div>
          ) : catalogError ? (
            <p className="conn-error small" role="alert">Couldn’t load brokerages: {catalogError}</p>
          ) : (
            <p className="muted small" role="status">Loading brokerages…</p>
          )}
        </>
      ) : (
        <>
          <header className="dialog-head">
            <button type="button" className="icon-btn" aria-label="Back to brokerages" onClick={back} disabled={pending}>
              <BackIcon />
            </button>
            <BrokerageLogo name={option.name} url={option.logo_url} />
            <h2 id="connect-title">{option.name}</h2>
            {close}
          </header>
          {error && <p className="conn-error small" role="alert">{error}</p>}
          {option.id === 'questrade' ? (
            <QuestradeSignIn oauth={option.oauth ?? false} pending={pending}
              onToken={(token) => void submit(() => onToken(token))} />
          ) : (
            <div className="conn-signin">
              <p className="small">
                Wealthsimple has no public API, so you sign in on SnapTrade’s secure portal. You enter your Wealthsimple
                email, password and 2-step code there, never in InvestIQ, and InvestIQ gets read-only access.
              </p>
              <button type="button" className="btn primary" disabled={pending}
                onClick={() => void submit(() => onSnapTrade(option))}>
                {pending ? 'Waiting for SnapTrade…' : 'Continue to SnapTrade'}
              </button>
              {pending && <p className="muted small">Finish in the SnapTrade window. This updates when it closes.</p>}
            </div>
          )}
        </>
      )}
    </dialog>
  )
}
