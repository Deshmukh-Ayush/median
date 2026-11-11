"use client"

import Link from "next/link"
import { startTransition, useActionState, useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"

import { saveGstProfile } from "@/app/onboarding/actions"
import { Field, FormError } from "@/components/forms/field"
import { EMPTY_FORM_STATE } from "@/lib/form-state"

export interface GstStateOption {
  code: string
  name: string
}

export interface GstProfileDefaults {
  legalName: string
  gstRegistered: "yes" | "no"
  gstin: string
  stateCode: string
  compositionScheme: boolean
  defaultGstRate: string
}

export function GstProfileForm({
  states,
  defaults,
}: {
  states: readonly GstStateOption[]
  defaults: GstProfileDefaults
}) {
  const [state, action, pending] = useActionState(
    saveGstProfile,
    EMPTY_FORM_STATE
  )
  const values = state.values
  const errors = state.fieldErrors
  const [registered, setRegistered] = useState(
    (values?.gstRegistered ?? defaults.gstRegistered) === "yes"
  )
  const [stateCode, setStateCode] = useState(
    values?.stateCode ?? defaults.stateCode
  )

  // A GSTIN starts with the state code, so fill the state in from it.
  function onGstinChange(text: string) {
    const prefix = text.trim().slice(0, 2)
    if (states.some((s) => s.code === prefix)) setStateCode(prefix)
  }

  return (
    <form
      // Not action={action}: React resets a form after its action, which
      // drops the controlled radio and select back to their first values.
      onSubmit={(event) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        startTransition(() => action(formData))
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <Field
        name="legalName"
        label="Legal name"
        hint="As on your GST certificate or PAN."
        autoComplete="organization"
        defaultValue={values?.legalName ?? defaults.legalName}
        error={errors?.legalName}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1.5 text-sm font-medium">
          Are you registered for GST?
        </legend>
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((option) => (
            <label
              key={option}
              className="flex flex-1 cursor-default items-center gap-2 rounded-md border border-default p-3 text-sm transition-colors hover:bg-subtle has-checked:border-fg has-checked:bg-subtle has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name="gstRegistered"
                value={option}
                checked={registered === (option === "yes")}
                onChange={() => setRegistered(option === "yes")}
                className="size-4 accent-fg outline-none"
              />
              {option === "yes" ? "Yes" : "Not yet"}
            </label>
          ))}
        </div>
      </fieldset>

      {registered ? (
        <>
          <Field
            name="gstin"
            label="GSTIN"
            required
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={15}
            placeholder="29ABCDE1234F1Z5"
            className="[&_input]:font-mono [&_input]:uppercase"
            defaultValue={values?.gstin ?? defaults.gstin}
            onChange={(e) => onGstinChange(e.target.value)}
            error={errors?.gstin}
          />
          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="compositionScheme"
                defaultChecked={
                  values
                    ? values.compositionScheme === "on"
                    : defaults.compositionScheme
                }
                className="mt-0.5 size-4 accent-fg"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">Composition scheme</span>
                <span className="text-xs text-fg-secondary">
                  You pay a flat rate on turnover and don&apos;t charge GST on
                  invoices.
                </span>
              </span>
            </label>
            {errors?.compositionScheme ? (
              <p className="text-xs text-danger">{errors.compositionScheme}</p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-stateCode">State</Label>
        <select
          id="field-stateCode"
          name="stateCode"
          value={stateCode}
          onChange={(e) => setStateCode(e.target.value)}
          aria-invalid={errors?.stateCode ? true : undefined}
          aria-describedby={
            errors?.stateCode ? "field-stateCode-error" : "field-stateCode-hint"
          }
          className="h-8 rounded-sm border border-input bg-surface px-2 text-sm aria-invalid:border-danger"
        >
          <option value="">Choose a state</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
        {errors?.stateCode ? (
          <p id="field-stateCode-error" className="text-xs text-danger">
            {errors.stateCode}
          </p>
        ) : (
          <p id="field-stateCode-hint" className="text-xs text-fg-secondary">
            Where the business is registered. It decides CGST + SGST or IGST.
          </p>
        )}
      </div>

      <Field
        name="defaultGstRate"
        label="Default GST rate (%)"
        inputMode="decimal"
        placeholder="18"
        hint="For sales we can't match to a product. Leave blank to review each one."
        defaultValue={values?.defaultGstRate ?? defaults.defaultGstRate}
        error={errors?.defaultGstRate}
      />

      <FormError message={state.error} />
      <div className="flex flex-col gap-2">
        <Button type="submit" variant="primary" loading={pending}>
          Save and continue
        </Button>
        <Link
          href="/onboarding/consent"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Skip for now
        </Link>
      </div>
    </form>
  )
}
