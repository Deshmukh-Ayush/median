/** Median shows dates and times in Indian Standard Time. */
export const TIME_ZONE = "Asia/Kolkata"

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/** "2026-11" → "November 2026". Returns the input if it isn't YYYY-MM. */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined
  return match && month ? `${month} ${match[1]}` : period
}

const isoDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE })

/** Today's date in IST as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return isoDateFormat.format(now)
}

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
})

/** An ISO timestamp as "5 Nov, 4:42 pm" in IST. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return timeFormat.format(date).replace(/\s?([ap])\.?m\.?$/i, " $1m")
}

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
})

/** "2026-11-05" → "5 Nov 2026". Returns the input if it isn't a valid date. */
export function formatDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== isoDate
  )
    return isoDate
  return dateFormat.format(date)
}
