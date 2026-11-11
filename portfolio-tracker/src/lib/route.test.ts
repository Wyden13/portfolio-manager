import { describe, expect, it } from 'vitest'
import { hashFor, holdingHash, parseHash } from './route'

describe('routes', () => {
  it('round-trips tabs and their query', () => {
    expect(hashFor('portfolio')).toBe('#/portfolio')
    expect(holdingHash('RY.TO')).toBe('#/holding?symbol=RY.TO')
    const r = parseHash('#/markets?view=screener')
    expect(r.tab).toBe('markets')
    expect(r.params.get('view')).toBe('screener')
  })

  it('treats the root and unknown paths as the landing page', () => {
    expect(parseHash('').tab).toBe('landing')
    expect(parseHash('#/').tab).toBe('landing')
    expect(parseHash('#/nope').tab).toBe('landing')
  })

  it('keeps old links working', () => {
    const linked = parseHash('#/connections?linked=snaptrade')
    expect(linked.tab).toBe('connect')
    expect(linked.params.get('linked')).toBe('snaptrade')
    const ledger = parseHash('#/ledger')
    expect(ledger.tab).toBe('accounts')
    expect(ledger.params.get('view')).toBe('history')
    expect(parseHash('#/holdings?symbol=SHOP.TO').tab).toBe('holding')
    expect(parseHash('#/holdings').tab).toBe('holdings')
  })
})
