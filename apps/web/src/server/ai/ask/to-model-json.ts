import { formatInr, paise } from "@workspace/ledger"

/** JSON the model can read: no bigint, no Date, no undefined. */
export type ModelJson =
  | string
  | number
  | boolean
  | null
  | readonly ModelJson[]
  | { readonly [key: string]: ModelJson }

/**
 * Turns a service result into plain JSON for the model.
 *
 * Every bigint in the contracts is Money (integer paise), so each one becomes
 * formatted rupees ("₹1,23,456.00"). The model only ever sees finished
 * figures to quote; it never gets paise to divide or add up.
 */
export function toModelJson(value: unknown): ModelJson {
  if (value === null || value === undefined) return null
  if (typeof value === "bigint") return formatInr(paise(value))
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toModelJson)
  if (typeof value === "object") {
    const out: Record<string, ModelJson> = {}
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || typeof v === "function") continue
      out[key] = toModelJson(v)
    }
    return out
  }
  return null
}
