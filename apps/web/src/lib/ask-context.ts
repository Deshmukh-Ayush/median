import { idSchema, isoDateSchema, periodSchema } from "@workspace/contracts"
import { z } from "zod"

/**
 * What the user is looking at when they ask, sent with each question so
 * "this invoice" or "this month" resolve. Built from the current route on the
 * client; the server treats it as untrusted input: only a path, record ids
 * and a period, never free text, and tools still check the org and role.
 */
export const askPageContextSchema = z.object({
  /** The app path, e.g. "/invoices/0f8c…" or "/reports". */
  page: z
    .string()
    .max(200)
    .regex(/^\/[\w\-/]*$/, "Not an app path"),
  /** Records on screen: an invoice, party or inbox item. */
  ids: z.array(idSchema).max(10).default([]),
  /** The period on screen: a GST month, a date range or an as-of date. */
  period: z
    .union([
      z.object({ month: periodSchema }),
      z.object({ from: isoDateSchema, to: isoDateSchema }),
      z.object({ asOf: isoDateSchema }),
    ])
    .optional(),
})

export type AskPageContext = z.input<typeof askPageContextSchema>
