const f = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', opts)

const TIME = f({ hour: '2-digit', minute: '2-digit', hour12: false })
const DAY = f({ month: 'short', day: 'numeric' })
const DAY_YEAR = f({ month: 'short', day: 'numeric', year: 'numeric' })
const MONTH = f({ month: 'short' })
const MONTH_YEAR = f({ month: 'short', year: 'numeric' })
const YEAR = f({ year: 'numeric' })

const toDate = (t: number | string | Date) =>
  t instanceof Date ? t : typeof t === 'number' ? new Date(t * 1000) : new Date(t)

/** 11:48 */
export const clock = (t: number | string | Date) => TIME.format(toDate(t))
/** Nov 11 */
export const shortDay = (t: number | string | Date) => DAY.format(toDate(t))
/** Nov 11, 2026 */
export const longDay = (t: number | string | Date) => DAY_YEAR.format(toDate(t))
export const month = (t: number | string | Date) => MONTH.format(toDate(t))
export const monthYear = (t: number | string | Date) => MONTH_YEAR.format(toDate(t))
export const year = (t: number | string | Date) => YEAR.format(toDate(t))

/** A date `days` from today (negative = past), at local midnight. */
export function daysFromToday(days: number, now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() + days)
  return d
}

/** Heading for a day of news: "Today · Nov 11", "Yesterday · Nov 10", "Nov 7". */
export function dayHeading(daysAgo: number, now = new Date()): string {
  const d = shortDay(daysFromToday(-daysAgo, now))
  return daysAgo === 0 ? `Today · ${d}` : daysAgo === 1 ? `Yesterday · ${d}` : d
}

/** Trade dates are stored as naive UTC; show the calendar day without shifting it into local time. */
const UTC_DAY = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
export const tradeDay = (iso: string) => UTC_DAY.format(new Date(`${iso}Z`))
const UTC_SHORT = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const tradeDayShort = (iso: string) => UTC_SHORT.format(new Date(`${iso}Z`))
