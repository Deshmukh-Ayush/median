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
  try {
    await getAuth().api.signInEmail({
      body: parsed.data,
      headers: await headers(),
    })
  } catch (error) {
    const message = authErrorMessage(error)
    if (message === null) throw error
    return { error: message, values: { email: raw.email } }
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
