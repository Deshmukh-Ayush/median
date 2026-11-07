"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { isServiceError } from "@workspace/contracts"
import { InvalidMoneyError, parseRupees } from "@workspace/ledger"

import { createInvoice, createInvoiceInputSchema } from "@/server/services"

import { getOrgContextOrRedirect } from "../../org-context"

export interface InvoiceFormState {
  readonly error?: string
  /** Keyed by field: "partyId", "dueDate", "lines.0.hsnSac", … */
  readonly fieldErrors?: Readonly<Record<string, string>>
}

/** One line as the builder sends it: text, parsed here. */
const lineFormSchema = z.object({
  description: z.string(),
  hsnSac: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  gstRateBps: z.string(),
})

const formSchema = z.object({
  partyId: z.string().min(1, "Choose a customer."),
  invoiceDate: z.string().min(1, "Enter the invoice date."),
  dueDate: z.string().min(1, "Enter the due date."),
  placeOfSupply: z.string().min(1, "Choose the place of supply."),
  notes: z.string(),
  lines: z.array(lineFormSchema).min(1, "Add at least one line."),
})

const formText = (formData: FormData, key: string) => {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

/** Zod issue path → the builder's field key ("lines.0.hsnSac"). */
const keyOf = (path: readonly PropertyKey[]) => path.map(String).join(".")

/**
 * Creates and posts the invoice. The UI sends text only; tax, totals and the
 * supply type are worked out by createInvoice, never here.
 */
export async function createInvoiceFromForm(
  _previous: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  let linesRaw: unknown
  try {
    linesRaw = JSON.parse(formText(formData, "lines"))
  } catch {
    return { error: "Something went wrong with the lines. Reload and retry." }
  }
  const form = formSchema.safeParse({
    partyId: formText(formData, "partyId"),
    invoiceDate: formText(formData, "invoiceDate"),
    dueDate: formText(formData, "dueDate"),
    placeOfSupply: formText(formData, "placeOfSupply"),
    notes: formText(formData, "notes"),
    lines: linesRaw,
  })
  if (!form.success) {
    return {
      fieldErrors: Object.fromEntries(
        form.error.issues.map((i) => [keyOf(i.path), i.message])
      ),
    }
  }

  // Rupee text → paise. Anything unreadable is a field error, not a guess.
  const fieldErrors: Record<string, string> = {}
  const lines = form.data.lines.map((line, index) => {
    let unitPrice = 0n
    try {
      unitPrice = parseRupees(line.unitPrice.trim() || "x")
    } catch (error) {
      if (!(error instanceof InvalidMoneyError)) throw error
      fieldErrors[`lines.${index}.unitPrice`] = "Enter a price like 1,000.00."
    }
    return {
      description: line.description,
      hsnSac: line.hsnSac,
      quantity: line.quantity,
      unitPrice,
      gstRateBps: Number(line.gstRateBps),
    }
  })

  const input = {
    partyId: form.data.partyId,
    invoiceDate: form.data.invoiceDate,
    dueDate: form.data.dueDate,
    placeOfSupply: form.data.placeOfSupply,
    notes: form.data.notes.trim() || null,
    lines,
  }
  // The backend's own schema, for field-level messages before the call.
  const checked = createInvoiceInputSchema.safeParse(input)
  if (!checked.success) {
    for (const issue of checked.error.issues) {
      const key = keyOf(issue.path) || "form"
      fieldErrors[key] ??= issue.message
    }
  }
  if (!checked.success || Object.keys(fieldErrors).length > 0) {
    const { form: formError, ...rest } = fieldErrors
    return formError
      ? { error: formError, fieldErrors: rest }
      : { fieldErrors: rest }
  }

  const ctx = await getOrgContextOrRedirect()
  let invoiceId: string
  try {
    invoiceId = (await createInvoice(ctx, checked.data)).id
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    throw error
  }
  redirect(`/invoices/${invoiceId}`)
}
