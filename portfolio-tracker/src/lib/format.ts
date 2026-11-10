const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${compact}`
  let f = formatters.get(key)
  if (!f) {
    const opts: Intl.NumberFormatOptions = compact
      ? { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    try {
      f = new Intl.NumberFormat(undefined, { ...opts, style: 'currency', currency })
    } catch {
      // Unknown or empty currency code: plain number, the code is appended below.
      f = new Intl.NumberFormat(undefined, opts)
    }
    formatters.set(key, f)
  }
  return f
}

function format(value: number, currency: string, compact: boolean): string {
  const f = formatter(currency, compact)
  const text = f.format(value)
  return f.resolvedOptions().style === 'currency' || !currency ? text : `${text} ${currency}`
}

export function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—'
  return format(value, currency, false)
}

/** Short form for chart axes: CA$40.2K. */
export function compactMoney(value: number, currency: string): string {
  return format(value, currency, true)
}

export function signedMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—'
  return (value > 0 ? '+' : '') + money(value, currency)
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '—'
  const fixed = value.toFixed(digits)
  if (Number(fixed) === 0) return `${(0).toFixed(digits)}%` // no "-0.00%"
  return `${value > 0 ? '+' : ''}${fixed}%`
}

export const tone = (value: number | null | undefined): 'gain' | 'loss' | 'flat' =>
  !value ? 'flat' : value > 0 ? 'gain' : 'loss'

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
