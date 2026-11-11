import { describe, expect, it } from 'vitest'
import { activityTitle } from './kinds'

const row = { symbol: null, quantity: 0, price: 0, description: '' }

describe('activityTitle', () => {
  it('describes trades with quantity and price', () => {
    expect(activityTitle({ ...row, kind: 'BUY', symbol: 'XEQT', quantity: 20, price: 36.48 })).toBe('Bought 20 XEQT at 36.48')
    expect(activityTitle({ ...row, kind: 'SELL', symbol: 'BCE', quantity: 5, price: 0.5 })).toBe('Sold 5 BCE at 0.5000')
  })

  it('names dividends, contributions and other rows', () => {
    expect(activityTitle({ ...row, kind: 'DIVIDEND', symbol: 'BCE' })).toBe('BCE dividend')
    expect(activityTitle({ ...row, kind: 'DEPOSIT' })).toBe('Contribution')
    expect(activityTitle({ ...row, kind: 'FEE' })).toBe('Fee')
    expect(activityTitle({ ...row, kind: 'OTHER', description: 'Journal' })).toBe('Journal')
  })
})
