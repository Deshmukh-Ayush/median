/**
 * GSTIN helpers. A GSTIN is 15 characters: 2-digit state code, 10-character
 * PAN, entity number, "Z", and a check character (mod-36 Luhn variant).
 */

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Check character for the first 14 characters of a GSTIN, or null. */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = CHARS.indexOf(first14.charAt(i))
    if (value < 0) return null
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARS.charAt((36 - (sum % 36)) % 36)
}

export type GstinProblem = "format" | "checksum" | "state"

/** Why a GSTIN is invalid, or null if it is valid. */
export function gstinProblem(raw: string): GstinProblem | null {
  const gstin = raw.trim().toUpperCase()
  if (!FORMAT.test(gstin)) return "format"
  if (!isGstStateCode(gstin.slice(0, 2))) return "state"
  return gstinCheckChar(gstin.slice(0, 14)) === gstin.charAt(14)
    ? null
    : "checksum"
}

/** GST state codes: 01–38, 97 (other territory), 99 (centre jurisdiction). */
export function isGstStateCode(code: string): boolean {
  if (!/^\d{2}$/.test(code)) return false
  const n = Number(code)
  return (n >= 1 && n <= 38) || n === 97 || n === 99
}
