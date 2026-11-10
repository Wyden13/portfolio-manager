import { describe, expect, it } from 'vitest'
import type { BrokerageCatalog, ConnectionsOverview } from '../types'
import { initials, institutionCards, logoFor, outcomeOf, timeAgo } from './connections'
import { hashFor, parseHash } from './route'

const account = (id: number) => ({ id, account_type: 'TFSA', account_number: `••000${id}`, removed: false, duplicate: false })

describe('parseHash', () => {
  it('reads the tab and the query a broker sign-in returns with', () => {
    const { tab, params } = parseHash('#/connections?linked=questrade')
    expect(tab).toBe('connections')
    expect(params.get('linked')).toBe('questrade')
  })
  it('falls back to the dashboard', () => {
    expect(parseHash('').tab).toBe('dashboard')
    expect(parseHash('#/nope?x=1').tab).toBe('dashboard')
    expect(parseHash(hashFor('ledger')).tab).toBe('ledger')
  })
})

describe('institutionCards', () => {
  const overview: ConnectionsOverview = {
    options: { questrade_oauth: true, snaptrade: true },
    connections: [
      {
        platform: 'snaptrade', status: 'needs_reauth', last_error: 'rejected', last_synced_at: '2026-11-10T10:00:00Z',
        institutions: [
          { name: 'Interactive Brokers', accounts: [account(1)] },
          { name: 'Wealthsimple', accounts: [account(2), account(3)] },
        ],
      },
      {
        platform: 'questrade', status: 'active', last_error: null, last_synced_at: null,
        institutions: [{ name: 'Questrade', accounts: [account(4), account(5)] }],
      },
    ],
  }

  it('lists only linked institutions, Questrade first', () => {
    const cards = institutionCards(overview)
    expect(cards.map((c) => [c.platform, c.name, c.accounts.length])).toEqual([
      ['questrade', 'Questrade', 2], ['snaptrade', 'Interactive Brokers', 1], ['snaptrade', 'Wealthsimple', 2],
    ])
    expect(cards[2]).toMatchObject({ status: 'needs_reauth', lastError: 'rejected' })
  })

  it('is empty while SnapTrade waits for a link', () => {
    expect(institutionCards({
      options: { questrade_oauth: false, snaptrade: true },
      connections: [{ platform: 'snaptrade', status: 'pending', last_error: null, last_synced_at: null, institutions: [] }],
    })).toEqual([])
  })

  it('finds logos: the direct Questrade option, else by institution name', () => {
    const catalog: BrokerageCatalog = {
      options: [{ id: 'questrade', name: 'Questrade', method: 'direct', logo_url: 'qt.png', available: true, connected: true }],
      institution_logos: { Wealthsimple: 'ws.png' },
    }
    const [questrade, ibkr, wealthsimple] = institutionCards(overview)
    expect(logoFor(questrade, catalog)).toBe('qt.png')
    expect(logoFor(wealthsimple, catalog)).toBe('ws.png')
    expect(logoFor(ibkr, catalog)).toBeNull()
    expect(logoFor(questrade, null)).toBeNull()
  })
})

describe('initials', () => {
  it('takes the first letter of up to two words', () => {
    expect(initials('Interactive Brokers')).toBe('IB')
    expect(initials('Questrade')).toBe('Q')
    expect(initials('  wealthsimple   trade inc ')).toBe('WT')
  })
})

describe('outcomeOf', () => {
  it('syncs what was just linked', () => {
    expect(outcomeOf(new URLSearchParams('linked=snaptrade'))?.sync).toBe('snaptrade')
  })
  it('explains known errors and ignores an empty query', () => {
    expect(outcomeOf(new URLSearchParams('error=questrade_state'))?.text).toMatch(/expired/)
    expect(outcomeOf(new URLSearchParams('error=weird'))).toMatchObject({ tone: 'warn', text: 'Connecting failed (weird).' })
    expect(outcomeOf(new URLSearchParams())).toBeNull()
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  it('rounds to the largest unit', () => {
    expect(timeAgo('2026-11-10T11:59:50Z', now)).toBe('just now')
    expect(timeAgo('2026-11-10T11:55:00Z', now)).toMatch(/5 minutes ago/)
    expect(timeAgo('2026-11-09T12:00:00Z', now)).toMatch(/yesterday|1 day ago/)
  })
})
