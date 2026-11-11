import type { LedgerEntry, TransactionKind } from '../types'
import { num, qty } from './format'
import { displaySymbol } from './portfolio'

export const KINDS: readonly TransactionKind[] = ['BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'OTHER']

export const KIND_LABEL: Record<TransactionKind, string> = {
  BUY: 'Buy', SELL: 'Sell', DIVIDEND: 'Dividend', DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', FEE: 'Fee', OTHER: 'Other',
}

const price = (p: number) => num(p, p < 1 ? 4 : 2)

/** A ledger row as one line of recent activity: "Bought 20 XEQT at 36.48", "BCE dividend". */
export function activityTitle(t: Pick<LedgerEntry, 'kind' | 'symbol' | 'quantity' | 'price' | 'description'>): string {
  const sym = t.symbol ? displaySymbol(t.symbol) : ''
  switch (t.kind) {
    case 'BUY': return sym ? `Bought ${qty(t.quantity)} ${sym} at ${price(t.price)}` : 'Buy'
    case 'SELL': return sym ? `Sold ${qty(t.quantity)} ${sym} at ${price(t.price)}` : 'Sell'
    case 'DIVIDEND': return sym ? `${sym} dividend` : 'Dividend'
    case 'DEPOSIT': return 'Contribution'
    case 'OTHER': return t.description || (sym ? `${sym} · other` : 'Other')
    default: return sym ? `${KIND_LABEL[t.kind]} · ${sym}` : KIND_LABEL[t.kind]
  }
}
