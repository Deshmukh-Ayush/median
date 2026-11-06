"use client"

import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"

import type { IntegrationFormState } from "@/app/(app)/settings/integrations/actions"
import { Field } from "@/components/forms/field"

type FormAction = (
  previous: IntegrationFormState,
  formData: FormData
) => Promise<IntegrationFormState>

function Result({ state }: { state: IntegrationFormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    )
  }
  if (state.success) {
    return (
      <p role="status" className="text-sm text-success">
        {state.success}
      </p>
    )
  }
  return null
}

/** Razorpay test-mode API keys. Shown only in test mode. */
export function TestKeysForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = React.useActionState(action, {})
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Field
        name="keyId"
        label="Key id"
        placeholder="rzp_test_…"
        autoComplete="off"
        spellCheck={false}
        required
      />
      <Field
        name="keySecret"
        label="Key secret"
        type="password"
        autoComplete="off"
        required
      />
      <Result state={state} />
      <Button type="submit" size="sm" loading={pending} className="self-start">
        Connect test account
      </Button>
    </form>
  )
}

/** CSV upload through a file connector (settlement report, bank statement). */
export function FileImportForm({
  action,
  provider,
  accept,
  buttonLabel,
  connections,
}: {
  action: FormAction
  provider: string
  accept: readonly string[]
  buttonLabel: string
  /** Bank statements: which bank connection the file is for. */
  connections?: readonly { id: string; label: string }[]
}) {
  const [state, formAction, pending] = React.useActionState(action, {})
  const fileId = `import-${provider}-file`
  const connectionFieldId = `import-${provider}-connection`
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="provider" value={provider} />
      {connections ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={connectionFieldId}>Bank account</Label>
          <select
            id={connectionFieldId}
            name="connectionId"
            required
            className="h-8 rounded-sm border border-input bg-surface px-2 text-sm"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fileId}>CSV file</Label>
        <input
          id={fileId}
          name="file"
          type="file"
          required
          accept={[...accept.filter((t) => t === "text/csv"), ".csv"].join(",")}
          className="text-sm file:mr-3 file:h-8 file:rounded-sm file:border file:border-input file:bg-surface file:px-2.5 file:text-sm"
        />
      </div>
      <Result state={state} />
      <Button type="submit" size="sm" loading={pending} className="self-start">
        {buttonLabel}
      </Button>
    </form>
  )
}
