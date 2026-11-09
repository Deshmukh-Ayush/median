"use client"

import { startTransition, useActionState, useState } from "react"

import { CREDIT_NOTE_REASONS } from "@workspace/contracts"
import type {
  CreditNoteReason,
  Money as MoneyValue,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Money } from "@workspace/ui/components/money"
import { Textarea } from "@workspace/ui/components/textarea"

import { createCreditNoteFromForm } from "@/app/(app)/invoices/[id]/credit-note/actions"
import type { CreditNoteFormState } from "@/app/(app)/invoices/[id]/credit-note/actions"
import { FormError } from "@/components/forms/field"
import { CREDIT_NOTE_REASON_LABELS } from "@/lib/credit-notes"
import type { CreditLineDraft, CreditMode } from "@/lib/credit-notes"

export interface CreditableLine {
  readonly id: string
  readonly description: string
  readonly hsnSac: string
  readonly quantity: string
  readonly unitPrice: MoneyValue
  readonly taxable: MoneyValue
  readonly gstRateBps: number
}

const INITIAL: CreditNoteFormState = {}
const modeOf = (v: string): CreditMode =>
  v === "quantity" ? "quantity" : "taxable"
const SELECT =
  "h-8 rounded-sm border border-input bg-surface px-2 text-sm aria-invalid:border-danger"

/**
 * Credit note against one invoice: per line, a quantity returned or a
 * taxable value credited. Tax and totals are worked out on create.
 */
export function CreditNoteForm({
  invoiceId,
  lines,
  today,
  defaultReason = "refund",
}: {
  invoiceId: string
  lines: readonly CreditableLine[]
  today: string
  defaultReason?: CreditNoteReason
}) {
  const [state, action, pending] = useActionState(
    createCreditNoteFromForm,
    INITIAL
  )
  const errors = state.fieldErrors ?? {}
  const [drafts, setDrafts] = useState<CreditLineDraft[]>(() =>
    lines.map((l) => ({ invoiceLineId: l.id, mode: "taxable", value: "" }))
  )

  function setDraft(id: string, patch: Partial<CreditLineDraft>) {
    setDrafts((all) =>
      all.map((d) => (d.invoiceLineId === id ? { ...d, ...patch } : d))
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        formData.set("lines", JSON.stringify(drafts))
        startTransition(() => action(formData))
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <section className="grid gap-4 rounded-lg border border-default bg-surface p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="creditNoteDate">Credit note date</Label>
          <Input
            id="creditNoteDate"
            name="creditNoteDate"
            type="date"
            defaultValue={today}
            aria-invalid={errors.creditNoteDate ? true : undefined}
          />
          {errors.creditNoteDate ? (
            <p className="text-xs text-danger">{errors.creditNoteDate}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">Reason</Label>
          <select
            id="reason"
            name="reason"
            defaultValue={defaultReason}
            aria-invalid={errors.reason ? true : undefined}
            className={SELECT}
          >
            {CREDIT_NOTE_REASONS.map((r) => (
              <option key={r} value={r}>
                {CREDIT_NOTE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
          {errors.reason ? (
            <p className="text-xs text-danger">{errors.reason}</p>
          ) : null}
        </div>
      </section>

      <section
        aria-labelledby="credit-lines"
        className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5"
      >
        <div>
          <h2 id="credit-lines" className="text-sm font-semibold">
            What to credit
          </h2>
          <p className="text-xs text-fg-secondary">
            Leave a line blank to skip it. GST is credited at the invoice&apos;s
            rate.
          </p>
        </div>
        <ol className="flex flex-col gap-4">
          {lines.map((line) => {
            const draft = drafts.find((d) => d.invoiceLineId === line.id)
            const error = errors[`lines.${line.id}`]
            const inputId = `credit-${line.id}`
            return (
              <li
                key={line.id}
                className="grid gap-3 border-t border-default pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,3fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]"
              >
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">{line.description}</span>
                  <span className="text-xs text-fg-secondary">
                    HSN/SAC {line.hsnSac} · Qty {line.quantity} at{" "}
                    <Money
                      value={line.unitPrice}
                      className="text-fg-secondary"
                    />{" "}
                    · Taxable{" "}
                    <Money value={line.taxable} className="text-fg-secondary" />{" "}
                    · GST {line.gstRateBps / 100}%
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${inputId}-mode`}>Credit by</Label>
                  <select
                    id={`${inputId}-mode`}
                    value={draft?.mode ?? "taxable"}
                    onChange={(e) =>
                      setDraft(line.id, {
                        mode: modeOf(e.target.value),
                        value: "",
                      })
                    }
                    className={SELECT}
                  >
                    <option value="taxable">Amount (taxable value)</option>
                    <option value="quantity">Quantity returned</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={inputId}>
                    {draft?.mode === "quantity" ? "Quantity" : "Amount (₹)"}
                  </Label>
                  <Input
                    id={inputId}
                    value={draft?.value ?? ""}
                    onChange={(e) =>
                      setDraft(line.id, { value: e.target.value })
                    }
                    inputMode="decimal"
                    placeholder={draft?.mode === "quantity" ? "1" : "10,000.00"}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : undefined}
                  />
                  {error ? (
                    <p id={`${inputId}-error`} className="text-xs text-danger">
                      {error}
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="flex flex-col gap-1.5 rounded-lg border border-default bg-surface p-5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
      </section>

      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          Issue credit note
        </Button>
        <p className="text-xs text-fg-secondary">
          This posts the credit note and lowers what the customer owes.
        </p>
      </div>
    </form>
  )
}
