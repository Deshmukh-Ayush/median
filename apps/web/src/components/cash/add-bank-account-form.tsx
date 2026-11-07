"use client"

import { useActionState } from "react"

import { Button } from "@workspace/ui/components/button"

import { addBankAccount } from "@/app/(app)/cash/upload/actions"
import type { AddBankAccountState } from "@/app/(app)/cash/upload/actions"
import { Field, FormError } from "@/components/forms/field"

const INITIAL: AddBankAccountState = {}

/**
 * Adds a bank account: a new account under Bank in your books, ready for
 * statement uploads. The backend picks its ledger code.
 */
export function AddBankAccountForm({
  title = "Add a bank account",
}: {
  title?: string
}) {
  const [state, action, pending] = useActionState(addBankAccount, INITIAL)
  return (
    <form
      action={action}
      className="flex max-w-md flex-col gap-4 rounded-lg border border-default bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-fg-secondary">
          We add it under Bank in your books. Its statement lines post there.
        </p>
      </div>
      <Field
        name="bankName"
        label="Bank"
        placeholder="HDFC Bank"
        required
        maxLength={100}
        defaultValue={state.values?.bankName}
        error={state.fieldErrors?.bankName}
      />
      <Field
        name="name"
        label="Account name"
        placeholder="Current account"
        required
        maxLength={100}
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <Field
        name="last4"
        label="Last 4 digits"
        hint="Of the account number, to tell your accounts apart."
        placeholder="1234"
        required
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        autoComplete="off"
        defaultValue={state.values?.last4}
        error={state.fieldErrors?.last4}
      />
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
