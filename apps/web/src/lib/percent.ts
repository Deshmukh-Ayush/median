import { z } from "zod"

/**
 * A percentage typed by a person ("18", "1.5", "0.25") as integer basis
 * points (1800, 150, 25). Up to two decimals; no floats are involved.
 */
export const percentTextSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a rate like 2 or 1.5.")
  .transform((text) => {
    const [whole = "0", fraction = ""] = text.split(".")
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  })

/** Basis points as the text a person would type: 1800 → "18", 150 → "1.5". */
export function bpsToPercentText(bps: number): string {
  const whole = Math.trunc(bps / 100)
  const fraction = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : String(whole)
}
