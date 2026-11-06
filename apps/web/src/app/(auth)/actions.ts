"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { authErrorMessage } from "@/lib/auth-errors"
import { fieldErrorsOf, formValues } from "@/lib/form-state"
import type { FormState } from "@/lib/form-state"
import { safeRedirect } from "@/lib/safe-redirect"
import { getAuth } from "@/server/auth"

const email = z.email("Enter a valid email address.").trim().toLowerCase()

const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
})

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email,
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128, "Use at most 128 characters."),
})

export async function signIn(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const raw = formValues(formData, ["email", "password", "redirectTo"])
  const parsed = signInSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: fieldErrorsOf(parsed.error),
      values: { email: raw.email },
    }
  }
  const auth = getAuth()
  let sessionCookies: string
  try {
    const result = await auth.api.signInEmail({
      body: parsed.data,
      headers: await headers(),
      returnHeaders: true,
    })
    // The new session's cookies, so we can act as it in this same request.
    sessionCookies = result.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ")
  } catch (error) {
    const message = authErrorMessage(error)
    if (message === null) throw error
    return { error: message, values: { email: raw.email } }
  }
  // A new session has no active organisation, so every app page would send
  // the user to the picker and lose redirectTo. With exactly one
  // organisation there's nothing to pick: open it.
  const asNewSession = new Headers({ cookie: sessionCookies })
  const organizations = await auth.api.listOrganizations({
    headers: asNewSession,
  })
  const [only] = organizations
  if (only && organizations.length === 1) {
    await auth.api.setActiveOrganization({
      body: { organizationId: only.id },
      headers: asNewSession,
    })
  }
  redirect(safeRedirect(raw.redirectTo))
}

export async function signUp(
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const raw = formValues(formData, ["name", "email", "password", "redirectTo"])
  const parsed = signUpSchema.safeParse(raw)
  const values = { name: raw.name, email: raw.email }
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), values }
  }
  try {
    await getAuth().api.signUpEmail({
      body: parsed.data,
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message === null) throw error
    return { error: message, values }
  }
  // New accounts have no organisation yet, unless they came from an invite.
  redirect(safeRedirect(raw.redirectTo, "/onboarding"))
}

export async function signOut(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() })
  redirect("/sign-in")
}
