"use server"

import { refresh } from "next/cache"
import { z } from "zod"

import {
  BULK_APPROVE_MAX,
  TDS_SECTIONS,
  idSchema,
  inboxEditsSchema,
  isServiceError,
} from "@workspace/contracts"
import type { InboxEdits } from "@workspace/contracts"
import { InvalidMoneyError, parseRupees } from "@workspace/ledger"

import {
  approveInboxItem,
  bulkApproveInboxItems,
  rejectInboxItem,
} from "@/server/services"

import { getOrgContextOrRedirect } from "../org-context"

export type InboxActionResult =
  { ok: true; ids: string[] } | { ok: false; error: string; ids: string[] }

const idsSchema = z.array(idSchema).min(1).max(BULK_APPROVE_MAX)
const reasonSchema = z
  .string()
  .trim()
  .min(1, "Say why you're rejecting this.")
  .max(500)

function failure(error: unknown, ids: string[]): InboxActionResult {
  if (isServiceError(error)) return { ok: false, error: error.message, ids }
  throw error
}

/** Rupees typed by the reviewer, parsed to exact paise (no floats). */
const rupeesText = z
  .string()
  .trim()
  .min(1, "Enter an amount.")
  .transform((text, ctx) => {
    try {
      return parseRupees(text)
    } catch (error) {
      if (!(error instanceof InvalidMoneyError)) throw error
      ctx.addIssue({ code: "custom", message: `"${text}" isn't an amount.` })
      return z.NEVER
    }
  })

/** A percentage with up to two decimals ("2", "1.5"), as basis points. */
const percentText = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a rate like 2 or 1.5.")
  .transform((text) => {
    const [whole = "0", fraction = ""] = text.split(".")
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  })

/** The tax edits as the form sends them: text fields, parsed here. */
const taxEditsFormSchema = z.object({
  gst: z
    .object({
      taxable: rupeesText,
      cgst: rupeesText,
      sgst: rupeesText,
      igst: rupeesText,
    })
    .optional(),
  tds: z
    .object({
      section: z.enum(TDS_SECTIONS),
      rate: percentText,
      amount: rupeesText,
    })
    .nullable()
    .optional(),
})

export interface TaxEditsForm {
  gst?: { taxable: string; cgst: string; sgst: string; igst: string }
  /** Null removes TDS; omitted keeps the proposal. */
  tds?: { section: string; rate: string; amount: string } | null
}

/**
 * Approves one item, with the reviewer's GST and TDS edits if any. The
 * backend rebuilds the tax lines from them and checks the result; nothing is
 * computed here beyond parsing what was typed.
 */
export async function approveItem(
  id: unknown,
  edits: unknown
): Promise<InboxActionResult> {
  const itemId = idSchema.safeParse(id)
  if (!itemId.success) return { ok: false, error: "Unknown item.", ids: [] }
  const form = taxEditsFormSchema.safeParse(edits ?? {})
  if (!form.success) {
    return {
      ok: false,
      error: form.error.issues[0]?.message ?? "Check the tax fields.",
      ids: [],
    }
  }
  const { gst, tds } = form.data
  const candidate: InboxEdits = {
    ...(gst ? { gst } : {}),
    ...(tds === undefined
      ? {}
      : {
          tds: tds
            ? { section: tds.section, rateBps: tds.rate, amount: tds.amount }
            : null,
        }),
  }
  const parsed = inboxEditsSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the tax fields.",
      ids: [],
    }
  }
  const ctx = await getOrgContextOrRedirect()
  try {
    await approveInboxItem(ctx, itemId.data, parsed.data)
  } catch (error) {
    return failure(error, [])
  }
  refresh()
  return { ok: true, ids: [itemId.data] }
}

/**
 * Approves several items without edits. Each is posted on its own, so one
 * failure (say, a locked period) doesn't stop the rest; the first failure's
 * message is reported with the ids that did go through.
 */
export async function approveItems(ids: unknown): Promise<InboxActionResult> {
  const parsed = idsSchema.safeParse(ids)
  if (!parsed.success) {
    return {
      ok: false,
      error: `Pick between 1 and ${BULK_APPROVE_MAX} items.`,
      ids: [],
    }
  }
  const ctx = await getOrgContextOrRedirect()
  let result
  try {
    result = await bulkApproveInboxItems(ctx, parsed.data)
  } catch (error) {
    return failure(error, [])
  }
  refresh()
  const approved = result.approved.map((a) => a.id)
  const [first] = result.failed
  if (first) {
    const more = result.failed.length - 1
    return {
      ok: false,
      error: more > 0 ? `${first.message} (+${more} more)` : first.message,
      ids: approved,
    }
  }
  return { ok: true, ids: approved }
}

export async function rejectItem(
  id: unknown,
  reason: unknown
): Promise<InboxActionResult> {
  const itemId = idSchema.safeParse(id)
  const note = reasonSchema.safeParse(reason)
  if (!itemId.success) return { ok: false, error: "Unknown item.", ids: [] }
  if (!note.success) {
    return {
      ok: false,
      error: note.error.issues[0]?.message ?? "Add a reason.",
      ids: [],
    }
  }
  const ctx = await getOrgContextOrRedirect()
  try {
    await rejectInboxItem(ctx, itemId.data, note.data)
  } catch (error) {
    return failure(error, [])
  }
  refresh()
  return { ok: true, ids: [itemId.data] }
}
