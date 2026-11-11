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

// The design shows plain figures (248,312.40) with a true minus sign; the currency is stated once
// per page or column instead of on every number.
const MINUS = '−'
const plainFormats = new Map<number, Intl.NumberFormat>()

function plainFormat(digits: number): Intl.NumberFormat {
  let f = plainFormats.get(digits)
  if (!f) {
    f = new Intl.NumberFormat('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    plainFormats.set(digits, f)
  }
  return f
}

const isNumber = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v)
const roundsToZero = (v: number, digits: number) => Number(v.toFixed(digits)) === 0

/** 248312.4 -> "248,312.40"; negatives use a true minus sign; null -> em dash. */
export function num(value: number | null | undefined, digits = 2): string {
  if (!isNumber(value)) return '—'
  const text = plainFormat(digits).format(Math.abs(value))
  return value < 0 && !roundsToZero(value, digits) ? `${MINUS}${text}` : text
}

/** Always signed: "+1,018.42", "−430.00". Zero has no sign. */
export function signed(value: number | null | undefined, digits = 2): string {
  if (!isNumber(value)) return '—'
  return value > 0 && !roundsToZero(value, digits) ? `+${num(value, digits)}` : num(value, digits)
}

/** Headline money with a dollar sign: "$248,312.40", "−$430.00". */
export function dollars(value: number | null | undefined, digits = 2): string {
  if (!isNumber(value)) return '—'
  const text = `$${num(Math.abs(value), digits)}`
  return value < 0 && !roundsToZero(value, digits) ? `${MINUS}${text}` : text
}

/** Always-signed money: "+$1,018.42", "−$430.00". Zero has no sign. */
export function signedDollars(value: number | null | undefined, digits = 2): string {
  if (!isNumber(value)) return '—'
  return value > 0 && !roundsToZero(value, digits) ? `+${dollars(value, digits)}` : dollars(value, digits)
}

/** Signed percent with a true minus: "+0.41%", "−2.36%". */
export function signedPct(value: number | null | undefined, digits = 2): string {
  return isNumber(value) ? `${signed(value, digits)}%` : '—'
}

/** Unsigned percent: "19.1%". */
export function share(value: number | null | undefined, digits = 1): string {
  return isNumber(value) ? `${num(value, digits)}%` : '—'
}

/** Short magnitudes for caps and volumes: 205.6B, 4.8M, 912K. */
export function abbrev(value: number | null | undefined, digits = 1): string {
  if (!isNumber(value)) return '—'
  const abs = Math.abs(value)
  const [div, unit] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, '']
  // 0.2M rather than 200.0K, as the design writes volumes; whole units drop the decimal.
  if (unit === 'K' && abs >= 1e5) return `${num(value / 1e6, digits)}M`
  return `${num(value / div, unit ? digits : 0)}${unit}`
}

const fractional = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 3 })

/** Quantities: whole shares without decimals, fractional ones with up to 3. */
export function qty(value: number | null | undefined): string {
  if (!isNumber(value)) return '—'
  return Number.isInteger(value) ? num(value, 0) : fractional.format(value)
}

/** CSS class for a signed figure. */
export const dir = (value: number | null | undefined): '' | 'up' | 'dn' =>
  !value ? '' : value > 0 ? 'up' : 'dn'
