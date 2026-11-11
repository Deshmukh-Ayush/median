"use server"

import { refresh } from "next/cache"
import { redirect } from "next/navigation"
import {
  createPartyInputSchema,
  idSchema,
  isServiceError,
  updatePartyInputSchema,
} from "@workspace/contracts"
import type { ServiceError } from "@workspace/contracts"
import { InvalidMoneyError, parseRupees } from "@workspace/ledger"

import { fieldErrorsOf, formValues } from "@/lib/form-state"
import type { FormState } from "@/lib/form-state"
import { safeRedirect } from "@/lib/safe-redirect"
import { createParty, setPartyArchived, updateParty } from "@/server/services"

import { getOrgContextOrRedirect } from "../org-context"

const DETAIL_FIELDS = [
  "name",
  "legalName",
  "gstin",
  "pan",
  "registrationType",
  "stateCode",
  "billingAddress",
  "email",
  "phone",
  "paymentTermsDays",
  "defaultTdsSection",
  "msmeCategory",
  "udyamNumber",
] as const
const NUMERIC = new Set<string>(["paymentTermsDays"])

/**
 * The details in a form as service input. A blank field is `blank` (left
 * out on create, cleared on edit); a field not in the form is left out.
 */
function detailsOf(formData: FormData, blank: null | undefined) {
  const out: Record<string, string | number | null | undefined> = {}
  for (const key of DETAIL_FIELDS) {
    const raw = formData.get(key)
    if (typeof raw !== "string") continue
    const v = raw.trim()
    out[key] = v === "" ? blank : NUMERIC.has(key) ? Number(v) : v
  }
  return out
}

/** A service error as form state, on its field when it names one. */
function fromServiceError(
  error: ServiceError,
  values: Record<string, string>
): FormState {
  const details = error.details
  const field =
    details && typeof details === "object" && "field" in details
      ? details.field
      : null
  return typeof field === "string"
    ? { fieldErrors: { [field]: error.message }, values }
    : { error: error.message, values }
}

const ALL_FIELDS = [
  ...DETAIL_FIELDS,
  "kind",
  "obAmount",
  "obDate",
  "obDirection",
] as const

export async function createPartyFromForm(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const values = formValues(formData, ALL_FIELDS)
  let openingBalance = null
  if (values.obAmount.trim()) {
    try {
      openingBalance = {
        amount: parseRupees(values.obAmount),
        date: values.obDate,
        direction: values.obDirection,
      }
    } catch (error) {
      if (!(error instanceof InvalidMoneyError)) throw error
      return { fieldErrors: { obAmount: "Enter an amount in rupees." }, values }
    }
  }
  const parsed = createPartyInputSchema.safeParse({
    kind: values.kind,
    ...detailsOf(formData, undefined),
    openingBalance,
  })
  if (!parsed.success) {
    const errors = fieldErrorsOf(parsed.error)
    if (errors.openingBalance) errors.obAmount = errors.openingBalance
    return { fieldErrors: errors, values }
  }
  const ctx = await getOrgContextOrRedirect()
  let id: string
  try {
    id = (await createParty(ctx, parsed.data)).id
  } catch (error) {
    if (isServiceError(error)) return fromServiceError(error, values)
    throw error
  }
  // Back to where the form was opened from (e.g. a new invoice), with the
  // new party picked.
  const next = formData.get("next")
  if (typeof next === "string" && next) {
    const target = new URL(safeRedirect(next, "/parties"), "http://x")
    target.searchParams.set(
      values.kind === "vendor" ? "vendor" : "customer",
      id
    )
    redirect(`${target.pathname}${target.search}`)
  }
  redirect(`/parties/${id}`)
}

export async function updatePartyFromForm(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const values = formValues(formData, ALL_FIELDS)
  const id = idSchema.safeParse(formData.get("id"))
  if (!id.success) return { error: "This customer or vendor is missing." }
  const parsed = updatePartyInputSchema.safeParse(detailsOf(formData, null))
  if (!parsed.success)
    return { fieldErrors: fieldErrorsOf(parsed.error), values }
  const ctx = await getOrgContextOrRedirect()
  try {
    await updateParty(ctx, id.data, parsed.data)
  } catch (error) {
    if (isServiceError(error)) return fromServiceError(error, values)
    throw error
  }
  refresh()
  return {}
}

export async function setPartyArchivedFromForm(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const id = idSchema.safeParse(formData.get("id"))
  if (!id.success) return { error: "This customer or vendor is missing." }
  const ctx = await getOrgContextOrRedirect()
  try {
    await setPartyArchived(ctx, id.data, formData.get("archive") === "true")
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    throw error
  }
  refresh()
  return {}
}
