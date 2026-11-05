"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"

import { signUp } from "@/app/(auth)/actions"
import { Field, FormError } from "@/components/forms/field"
import { EMPTY_FORM_STATE } from "@/lib/form-state"

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const [state, action, pending] = useActionState(signUp, EMPTY_FORM_STATE)
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <Field
        name="name"
        label="Your name"
        autoComplete="name"
        required
        autoFocus
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <Field
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint="At least 8 characters."
        error={state.fieldErrors?.password}
      />
      <FormError message={state.error} />
      <Button type="submit" variant="primary" loading={pending}>
        Create account
      </Button>
    </form>
  )
}
