import type { BrokerageCatalog, ConnectionAccount, ConnectionsOverview, ConnectionStatus, Platform } from '../types'

/** One linked institution as the Connections tab shows it. */
export interface InstitutionCard {
  /** As stored on its accounts; disconnecting a SnapTrade institution sends this name. */
  name: string
  platform: Platform
  status: ConnectionStatus
  lastSyncedAt: string | null
  lastError: string | null
  accounts: ConnectionAccount[]
}

/** Questrade (direct) first, then each institution linked through SnapTrade. */
export function institutionCards(overview: ConnectionsOverview): InstitutionCard[] {
  return overview.connections
    .slice()
    .sort((a, b) => (a.platform === 'questrade' ? -1 : b.platform === 'questrade' ? 1 : 0))
    .flatMap((c): InstitutionCard[] => {
      const shared = { platform: c.platform, status: c.status, lastSyncedAt: c.last_synced_at, lastError: c.last_error }
      return c.platform === 'questrade'
        ? [{ ...shared, name: 'Questrade', accounts: c.institutions.flatMap((i) => i.accounts) }]
        : c.institutions.map((i) => ({ ...shared, name: i.name, accounts: i.accounts }))
    })
}

export function logoFor(card: InstitutionCard, catalog: BrokerageCatalog | null): string | null {
  if (!catalog) return null
  const direct = card.platform === 'questrade' ? catalog.options.find((o) => o.id === 'questrade')?.logo_url : null
  return direct ?? catalog.institution_logos[card.name] ?? null
}

/** Monogram for a brokerage without a logo: "Interactive Brokers" -> "IB", "Questrade" -> "Q". */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

export const needsAttention = (status: ConnectionStatus) => status === 'needs_reauth' || status === 'error'

export const STATUS_BADGE: Record<ConnectionStatus, { label: string; tone: string }> = {
  active: { label: 'Connected', tone: 'ok' },
  pending: { label: 'Waiting for link', tone: 'pending' },
  needs_reauth: { label: 'Sign in again', tone: 'down' },
  error: { label: 'Sync failed', tone: 'down' },
}

export interface Outcome {
  tone: 'ok' | 'warn'
  text: string
  /** Sync this platform now: it was just linked. */
  sync?: Platform
}

const ERRORS: Record<string, string> = {
  questrade_state: 'The Questrade sign-in expired or was started in another tab. Please try again.',
  questrade_rejected: 'Questrade did not accept the sign-in. Please try again.',
}

/** What a broker sign-in reported back in `#/connections?linked=…` or `?error=…`. */
export function outcomeOf(params: URLSearchParams): Outcome | null {
  const linked = params.get('linked')
  if (linked === 'questrade') return { tone: 'ok', text: 'Questrade connected. Syncing your accounts…', sync: 'questrade' }
  if (linked === 'snaptrade') return { tone: 'ok', text: 'Institution linked. Syncing your accounts…', sync: 'snaptrade' }
  const error = params.get('error')
  if (error) return { tone: 'warn', text: ERRORS[error] ?? `Connecting failed (${error}).` }
  return null
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86_400], ['hour', 3_600], ['minute', 60]]

/** "5 minutes ago"; server times are UTC ISO strings. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}
