import { describe, expect, it } from 'vitest'
import { abbrev, dir, num, qty, share, signed, signedPct } from './format'

describe('plain number formats', () => {
  it('groups thousands with two decimals and a true minus', () => {
    expect(num(248312.4)).toBe('248,312.40')
    expect(num(-430)).toBe('−430.00')
    expect(num(-0.001)).toBe('0.00')
    expect(num(null)).toBe('—')
  })

  it('signs changes', () => {
    expect(signed(1018.42)).toBe('+1,018.42')
    expect(signed(-3810)).toBe('−3,810.00')
    expect(signed(0)).toBe('0.00')
    expect(signed(0.001)).toBe('0.00')
    expect(signedPct(0.41)).toBe('+0.41%')
    expect(signedPct(-2.36)).toBe('−2.36%')
    expect(share(19.06)).toBe('19.1%')
  })

  it('abbreviates magnitudes and formats quantities', () => {
    expect(abbrev(205.6e9)).toBe('205.6B')
    expect(abbrev(4_812_340)).toBe('4.8M')
    expect(abbrev(950)).toBe('950')
    expect(abbrev(200_000)).toBe('0.2M')
    expect(abbrev(12_400)).toBe('12.4K')
    expect(qty(1120)).toBe('1,120')
    expect(qty(1.23456)).toBe('1.235')
    expect(dir(-1)).toBe('dn')
    expect(dir(0)).toBe('')
  })
})
