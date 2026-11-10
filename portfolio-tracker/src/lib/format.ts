export function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export function signedMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—'
  return (value > 0 ? '+' : '') + money(value, currency)
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`
}

export const tone = (value: number | null | undefined): 'gain' | 'loss' | 'flat' =>
  !value ? 'flat' : value > 0 ? 'gain' : 'loss'
