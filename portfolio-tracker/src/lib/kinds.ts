import type { TransactionKind } from '../types'

export const KINDS: readonly TransactionKind[] = ['BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'OTHER']

export const KIND_LABEL: Record<TransactionKind, string> = {
  BUY: 'Buy', SELL: 'Sell', DIVIDEND: 'Dividend', DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', FEE: 'Fee', OTHER: 'Other',
}
