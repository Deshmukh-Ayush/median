"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"

import { createOrganization } from "@/app/onboarding/actions"
import { Field, FormError } from "@/components/forms/field"
import { EMPTY_FORM_STATE } from "@/lib/form-state"

export interface BusinessTypeOption {
  value: string
  label: string
  description: string
}

export function CreateOrganizationForm({
  businessTypes,
}: {
  businessTypes: readonly BusinessTypeOption[]
}) {
  const [state, action, pending] = useActionState(
    createOrganization,
    EMPTY_FORM_STATE
  )
  const selected = state.values?.businessType ?? businessTypes[0]?.value
  const typeError = state.fieldErrors?.businessType
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Field
        name="name"
        label="Company name"
        autoComplete="organization"
        required
        autoFocus
        placeholder="Kaveri Labs Pvt Ltd"
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={typeError ? "business-type-error" : undefined}
      >
        <legend className="pb-1.5 text-sm font-medium">
          What kind of business is it?
        </legend>
        {businessTypes.map((type) => (
          <label
            key={type.value}
            className="flex cursor-default items-start gap-3 rounded-md border border-default bg-surface p-3 transition-colors hover:bg-app has-checked:border-fg has-checked:bg-app has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              name="businessType"
              value={type.value}
              defaultChecked={type.value === selected}
              className="mt-0.5 size-4 accent-fg outline-none"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{type.label}</span>
              <span className="text-xs text-fg-secondary">
                {type.description}
              </span>
            </span>
          </label>
        ))}
        {typeError ? (
          <p id="business-type-error" className="text-xs text-danger">
            {typeError}
          </p>
        ) : null}
      </fieldset>
      <FormError message={state.error} />
      <Button type="submit" variant="primary" loading={pending}>
        Create organisation
      </Button>
    </form>
  )
}
