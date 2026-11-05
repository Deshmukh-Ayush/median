"use server"

import { INDUSTRIES } from "@workspace/ledger"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { authErrorMessage } from "@/lib/auth-errors"
import { fieldErrorsOf, formValues } from "@/lib/form-state"
import type { FormState } from "@/lib/form-state"
import { getAuth } from "@/server/auth"

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
  redirect("/")
}

export async function openOrganization(organizationId: string): Promise<void> {
  await getAuth().api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  })
  redirect("/")
}
