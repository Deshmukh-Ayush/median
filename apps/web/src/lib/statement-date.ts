/**
 * Bank statement dates as Indian banks print them, to ISO "YYYY-MM-DD".
 * Day comes first (DD/MM/YYYY); two-digit years are 20YY. Returns null when
 * the text isn't a real calendar date, so the row is reported, not guessed.
 */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const pad = (n: number) => String(n).padStart(2, "0")

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

const fullYear = (text: string) =>
  text.length === 2 ? 2000 + Number(text) : Number(text)

export function parseStatementDate(raw: string): string | null {
  const text = raw.trim()

  // Already ISO: 2026-10-05
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))

  // 05/10/2026, 5-10-26, 05.10.2026
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)
  if (m) return iso(fullYear(m[3] ?? ""), Number(m[2]), Number(m[1]))

  // 05 Oct 2026, 05-Oct-26, 5 Sept, 2026
  m = /^(\d{1,2})[\s/-]+([A-Za-z]{3,4})[\s/,-]+(\d{2}|\d{4})$/.exec(text)
  if (m) {
    const month = MONTHS[(m[2] ?? "").toLowerCase()]
    return month ? iso(fullYear(m[3] ?? ""), month, Number(m[1])) : null
  }
  return null
}
