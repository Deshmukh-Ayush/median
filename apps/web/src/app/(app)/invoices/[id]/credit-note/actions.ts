"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import {
  CREDIT_NOTE_REASONS,
  createCreditNoteInputSchema,
  isServiceError,
} from "@workspace/contracts"
import type {
  CreateCreditNoteInput,
  CreditNotePreview,
} from "@workspace/contracts"
import { InvalidMoneyError, parseRupees } from "@workspace/ledger"

import { createCreditNote, previewCreditNote } from "@/server/services"

import { getOrgContextOrRedirect } from "../../../org-context"

export interface CreditNoteFormState {
  readonly error?: string
  /** Keyed by "creditNoteDate", "reason", "lines.<invoiceLineId>". */
  readonly fieldErrors?: Readonly<Record<string, string>>
}

const formSchema = z.object({
  invoiceId: z.string(),
  creditNoteDate: z.string().min(1, "Enter the credit note date."),
  reason: z.enum(CREDIT_NOTE_REASONS, "Choose a reason."),
  notes: z.string(),
  lines: z.array(
    z.object({
      invoiceLineId: z.string(),
      mode: z.enum(["quantity", "taxable"]),
      value: z.string(),
    })
  ),
})

const formText = (formData: FormData, key: string) => {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

/** The form's text → createCreditNote's input, or field errors. */
function parseCreditNoteForm(
  formData: FormData
):
  | { readonly ok: true; readonly input: CreateCreditNoteInput }
  | { readonly ok: false; readonly state: CreditNoteFormState } {
  const fail = (state: CreditNoteFormState) => ({ ok: false as const, state })
  let linesRaw: unknown
  try {
    linesRaw = JSON.parse(formText(formData, "lines"))
  } catch {
    return fail({
      error: "Something went wrong with the lines. Reload and retry.",
    })
  }
  const form = formSchema.safeParse({
    invoiceId: formText(formData, "invoiceId"),
    creditNoteDate: formText(formData, "creditNoteDate"),
    reason: formText(formData, "reason"),
    notes: formText(formData, "notes"),
    lines: linesRaw,
  })
  if (!form.success) {
    return fail({
      fieldErrors: Object.fromEntries(
        form.error.issues.map((i) => [i.path.map(String).join("."), i.message])
      ),
    })
  }

  const fieldErrors: Record<string, string> = {}
  type LineInput =
    | { invoiceLineId: string; quantity: string }
    | { invoiceLineId: string; taxable: bigint }
  const lines = form.data.lines.flatMap((l): LineInput[] => {
    const value = l.value.trim()
    if (!value) return []
    if (l.mode === "quantity")
      return [{ invoiceLineId: l.invoiceLineId, quantity: value }]
    try {
      return [{ invoiceLineId: l.invoiceLineId, taxable: parseRupees(value) }]
    } catch (error) {
      if (!(error instanceof InvalidMoneyError)) throw error
      fieldErrors[`lines.${l.invoiceLineId}`] = "Enter an amount like 1,000.00."
      return []
    }
  })
  if (lines.length === 0 && Object.keys(fieldErrors).length === 0)
    return fail({ error: "Enter what to credit on at least one line." })

  const checked = createCreditNoteInputSchema.safeParse({
    invoiceId: form.data.invoiceId,
    creditNoteDate: form.data.creditNoteDate,
    reason: form.data.reason,
    notes: form.data.notes.trim() || null,
    lines,
  })
  if (!checked.success) {
    for (const issue of checked.error.issues) {
      const [head, index] = issue.path
      const line =
        head === "lines" && typeof index === "number" ? lines[index] : undefined
      const key = line ? `lines.${line.invoiceLineId}` : String(head ?? "form")
      fieldErrors[key] ??= issue.message
    }
  }
  if (!checked.success || Object.keys(fieldErrors).length > 0) {
    const { form: formError, ...rest } = fieldErrors
    return fail(
      formError
        ? { error: formError, fieldErrors: rest }
        : { fieldErrors: rest }
    )
  }
  return { ok: true, input: checked.data }
}

/**
 * Issues a credit note. The form sends text; amounts and tax are worked out
 * by createCreditNote from the invoice's own lines, never here.
 */
export async function createCreditNoteFromForm(
  _previous: CreditNoteFormState,
  formData: FormData
): Promise<CreditNoteFormState> {
  const parsed = parseCreditNoteForm(formData)
  if (!parsed.ok) return parsed.state
  const ctx = await getOrgContextOrRedirect()
  let id: string
  try {
    id = (await createCreditNote(ctx, parsed.input)).id
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    throw error
  }
  redirect(`/invoices/credit-notes/${id}`)
}

export type CreditNotePreviewState =
  | { readonly status: "incomplete" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly preview: CreditNotePreview }

/** What the credit note would come to, from previewCreditNote. Saves nothing. */
export async function previewCreditNoteFromForm(
  formData: FormData
): Promise<CreditNotePreviewState> {
  const parsed = parseCreditNoteForm(formData)
  if (!parsed.ok) return { status: "incomplete" }
  const ctx = await getOrgContextOrRedirect()
  try {
    return {
      status: "ready",
      preview: await previewCreditNote(ctx, parsed.input),
    }
  } catch (error) {
    if (isServiceError(error))
      return { status: "error", message: error.message }
    throw error
  }
}
