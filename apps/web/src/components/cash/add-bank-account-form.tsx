"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"

import { addBankAccount } from "@/app/(app)/cash/upload/actions"
import type { AddBankAccountState } from "@/app/(app)/cash/upload/actions"
import { Field, FormError } from "@/components/forms/field"

const INITIAL: AddBankAccountState = {}

/** Adds a bank account (a label + its bank ledger account) for uploads. */
export function AddBankAccountForm({
  ledgerAccounts,
}: {
  ledgerAccounts: readonly { id: string; label: string }[]
}) {
  const [state, action, pending] = useActionState(addBankAccount, INITIAL)
  const accountError = state.fieldErrors?.ledgerAccountId
  return (
    <form
      action={action}
      className="flex max-w-md flex-col gap-4 rounded-lg border border-default bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Add a bank account</h2>
        <p className="text-xs text-fg-secondary">
          Tell us which account the statements are for. Its lines post to the
          bank account in your books.
        </p>
      </div>
      <Field
        name="label"
        label="Name"
        placeholder="HDFC current a/c"
        required
        defaultValue={state.values?.label}
        error={state.fieldErrors?.label}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="field-ledgerAccountId">Account in your books</Label>
        <select
          id="field-ledgerAccountId"
          name="ledgerAccountId"
          required
          defaultValue={state.values?.ledgerAccountId}
          aria-invalid={accountError ? true : undefined}
          aria-describedby={
            accountError ? "field-ledgerAccountId-error" : undefined
          }
          className="h-8 rounded-sm border border-input bg-surface px-2 text-sm aria-invalid:border-danger"
        >
          {ledgerAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        {accountError ? (
          <p id="field-ledgerAccountId-error" className="text-xs text-danger">
            {accountError}
          </p>
        ) : null}
      </div>
      <FormError message={state.error} />
      <Button
        type="submit"
        variant="primary"
        loading={pending}
        className="self-start"
      >
        Add bank account
      </Button>
    </form>
  )
}
