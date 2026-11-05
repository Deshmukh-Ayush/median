"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"

import { signIn } from "@/app/(auth)/actions"
import { Field, FormError } from "@/components/forms/field"
import { EMPTY_FORM_STATE } from "@/lib/form-state"

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [state, action, pending] = useActionState(signIn, EMPTY_FORM_STATE)
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Field
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <FormError message={state.error} />
      <Button type="submit" variant="primary" loading={pending}>
        Sign in
      </Button>
    </form>
  )
}
