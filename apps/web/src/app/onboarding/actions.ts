"use server"

import { isServiceError } from "@workspace/contracts"
import type { UpdateGstProfileInput } from "@workspace/contracts"
import { INDUSTRIES } from "@workspace/ledger"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { getOrgContextOrRedirect } from "@/app/(app)/org-context"
import { authErrorMessage } from "@/lib/auth-errors"
import { fieldErrorsOf, formValues } from "@/lib/form-state"
import type { FormState } from "@/lib/form-state"
import { gstinProblem } from "@/lib/gstin"
import type { GstinProblem } from "@/lib/gstin"
import { percentTextSchema } from "@/lib/percent"
import { getAuth } from "@/server/auth"
import { updateGstProfile } from "@/server/services"

const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter your company's name.")
    .max(80, "Keep it under 80 characters."),
  businessType: z.enum(INDUSTRIES, "Pick what kind of business you run."),
})

/** "Kaveri Labs Pvt Ltd" → "kaveri-labs-pvt-ltd-3f9a1c". Unique enough. */
function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  const suffix = crypto.randomUUID().slice(0, 6)
  return base ? `${base}-${suffix}` : `org-${suffix}`
}

export async function createOrganization(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const raw = formValues(formData, ["name", "businessType"])
  const parsed = createOrganizationSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), values: raw }
  }
  try {
    // The backend's afterCreateOrganization hook seeds the chart of accounts
    // from metadata.industry. Creating an organisation also makes it active.
    await getAuth().api.createOrganization({
      body: {
        name: parsed.data.name,
        slug: slugFor(parsed.data.name),
        metadata: { industry: parsed.data.businessType },
      },
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message === null) throw error
    return { error: message, values: raw }
  }
  // Step 2: the GST profile. It can be skipped and set later in Settings.
  redirect("/onboarding/gst")
}

export async function openOrganization(organizationId: string): Promise<void> {
  await getAuth().api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  })
  redirect("/")
}

const GST_FIELDS = [
  "legalName",
  "gstRegistered",
  "gstin",
  "stateCode",
  "compositionScheme",
  "defaultGstRate",
] as const

const GSTIN_PROBLEMS: Record<GstinProblem, string> = {
  format: "A GSTIN is 15 characters, like 29ABCDE1234F1Z5.",
  state: "The first two digits of this GSTIN aren't a GST state code.",
  checksum: "This GSTIN has a typo: its last character doesn't match.",
}

/** The GST step's text fields → updateGstProfile input. */
const gstProfileFormSchema = z
  .object({
    legalName: z
      .string()
      .trim()
      .max(200, "Keep it under 200 characters.")
      .transform((v) => v || null),
    gstRegistered: z.enum(["yes", "no"], "Tell us if you're GST registered."),
    gstin: z.string().trim().toUpperCase(),
    stateCode: z.string().trim(),
    compositionScheme: z.string(),
    defaultGstRate: z.union([z.literal(""), percentTextSchema]),
  })
  .superRefine((form, ctx) => {
    if (form.gstRegistered !== "yes") return
    if (!form.gstin) {
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "Enter your GSTIN.",
      })
      return
    }
    const problem = gstinProblem(form.gstin)
    if (problem) {
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: GSTIN_PROBLEMS[problem],
      })
    }
  })
  .transform((form): UpdateGstProfileInput => {
    const registered = form.gstRegistered === "yes"
    return {
      legalName: form.legalName,
      gstRegistered: registered,
      // Unregistered businesses have no GSTIN or composition scheme.
      gstin: registered ? form.gstin : null,
      compositionScheme: registered && form.compositionScheme === "on",
      stateCode: form.stateCode || null,
      defaultGstRateBps:
        form.defaultGstRate === "" ? null : form.defaultGstRate,
    }
  })

/** Field errors from a VALIDATION ServiceError's flattened Zod details. */
function serviceFieldErrors(details: unknown): Record<string, string> {
  const parsed = z
    .object({ fieldErrors: z.record(z.string(), z.array(z.string())) })
    .safeParse(details)
  const out: Record<string, string> = {}
  if (!parsed.success) return out
  for (const [key, messages] of Object.entries(parsed.data.fieldErrors)) {
    const first = messages[0]
    if (!first) continue
    // The form calls the rate "defaultGstRate"; the contract uses bps.
    out[key === "defaultGstRateBps" ? "defaultGstRate" : key] = first
  }
  return out
}

/** Onboarding step 2: the GST profile. Saves, then opens the app. */
export async function saveGstProfile(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const ctx = await getOrgContextOrRedirect()
  const raw = formValues(formData, GST_FIELDS)
  const parsed = gstProfileFormSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), values: raw }
  }
  try {
    await updateGstProfile(ctx, parsed.data)
  } catch (error) {
    if (!isServiceError(error)) throw error
    if (error.code === "VALIDATION") {
      const fieldErrors = serviceFieldErrors(error.details)
      return Object.keys(fieldErrors).length > 0
        ? { fieldErrors, values: raw }
        : { error: error.message, values: raw }
    }
    if (error.code === "FORBIDDEN") {
      return {
        error: "Only an owner or finance member can set the GST profile.",
        values: raw,
      }
    }
    throw error
  }
  // Step 3: consent, then step 4: bring data in.
  redirect("/onboarding/consent")
}
