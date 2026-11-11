"use client"

import { TriangleAlertIcon } from "lucide-react"
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"

import { CREDIT_NOTE_REASONS } from "@workspace/contracts"
import type {
  CreditNoteReason,
  Money as MoneyValue,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Money } from "@workspace/ui/components/money"
import { StatusChip } from "@workspace/ui/components/status-chip"
import { Textarea } from "@workspace/ui/components/textarea"

import {
  createCreditNoteFromForm,
  previewCreditNoteFromForm,
} from "@/app/(app)/invoices/[id]/credit-note/actions"
import type {
  CreditNoteFormState,
  CreditNotePreviewState,
} from "@/app/(app)/invoices/[id]/credit-note/actions"
import { FormError } from "@/components/forms/field"
import { CREDIT_NOTE_REASON_LABELS } from "@/lib/credit-notes"
import type { CreditLineDraft, CreditMode } from "@/lib/credit-notes"
import { isIntrastate } from "@/lib/invoices"

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
const PREVIEW_DELAY_MS = 400
const modeOf = (v: string): CreditMode =>
  v === "quantity" ? "quantity" : "taxable"
const reasonOf = (v: string): CreditNoteReason =>
  CREDIT_NOTE_REASONS.find((r) => r === v) ?? "refund"
const SELECT =
  "h-8 rounded-sm border border-input bg-surface px-2 text-sm aria-invalid:border-danger"

function formDataOf(form: HTMLFormElement, drafts: readonly CreditLineDraft[]) {
  const formData = new FormData(form)
  formData.set("lines", JSON.stringify(drafts))
  return formData
}

/**
 * Credit note against one invoice: per line, a quantity returned or a
 * taxable value credited. Totals come from previewCreditNote as you type;
 * nothing is added up here.
 */
export function CreditNoteForm({
  invoiceId,
  lines,
  today,
  defaultReason = "refund",
  refund,
}: {
  invoiceId: string
  lines: readonly CreditableLine[]
  today: string
  defaultReason?: CreditNoteReason
  /** The Razorpay refund this note is for (from an inbox item), if any. */
  refund?: { readonly amount: MoneyValue } | null
}) {
  const [state, action, pending] = useActionState(
    createCreditNoteFromForm,
    INITIAL
  )
  const errors = state.fieldErrors ?? {}
  const [drafts, setDrafts] = useState<CreditLineDraft[]>(() =>
    lines.map((l) => ({ invoiceLineId: l.id, mode: "taxable", value: "" }))
  )
  const [creditNoteDate, setCreditNoteDate] = useState(today)
  const [reason, setReason] = useState<CreditNoteReason>(defaultReason)

  const formRef = useRef<HTMLFormElement>(null)
  const latest = useRef(0)
  const [preview, setPreview] = useState<CreditNotePreviewState>({
    status: "incomplete",
  })
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const request = ++latest.current
    const timer = setTimeout(() => {
      setPreviewing(true)
      previewCreditNoteFromForm(formDataOf(form, drafts))
        .then((result) => {
          if (request === latest.current) setPreview(result)
        })
        .catch(() => {
          if (request === latest.current)
            setPreview({
              status: "error",
              message: "Couldn't work out the totals. Check your connection.",
            })
        })
        .finally(() => {
          if (request === latest.current) setPreviewing(false)
        })
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [drafts, creditNoteDate, reason])

  function setDraft(id: string, patch: Partial<CreditLineDraft>) {
    setDrafts((all) =>
      all.map((d) => (d.invoiceLineId === id ? { ...d, ...patch } : d))
    )
  }

  const ready = preview.status === "ready" ? preview.preview : null

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault()
        const formData = formDataOf(event.currentTarget, drafts)
        startTransition(() => action(formData))
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {refund ? (
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
          For a Razorpay refund of <Money value={refund.amount} />. Credit
          enough that the credit note&apos;s total matches it.
        </p>
      ) : null}
      <section className="grid gap-4 rounded-lg border border-default bg-surface p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="creditNoteDate">Credit note date</Label>
          <Input
            id="creditNoteDate"
            name="creditNoteDate"
            type="date"
            value={creditNoteDate}
            onChange={(e) => setCreditNoteDate(e.target.value)}
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
            value={reason}
            onChange={(e) => setReason(reasonOf(e.target.value))}
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
            const credited = ready?.lines.find(
              (l) => l.invoiceLineId === line.id
            )
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
                  {credited ? (
                    <span className="text-xs">
                      Crediting <Money value={credited.taxable} /> +{" "}
                      {isIntrastate(ready?.supplyType ?? "intrastate") ? (
                        <>
                          <Money value={credited.cgst} /> CGST +{" "}
                          <Money value={credited.sgst} /> SGST
                        </>
                      ) : (
                        <>
                          <Money value={credited.igst} /> IGST
                        </>
                      )}{" "}
                      = <Money value={credited.total} className="font-medium" />
                    </span>
                  ) : null}
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

      <PreviewPanel
        state={preview}
        pending={previewing}
        refundAmount={refund?.amount ?? null}
      />

      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          Issue credit note
        </Button>
        <p className="text-xs text-fg-secondary">
          This posts the credit note
          {ready ? ` (${ready.nextNumber})` : ""} and lowers what the customer
          owes.
        </p>
      </div>
    </form>
  )
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string
  value: MoneyValue
  strong?: boolean
}) {
  return (
    <>
      <dt className={strong ? "font-semibold" : "text-fg-secondary"}>
        {label}
      </dt>
      <dd className={`text-right ${strong ? "font-semibold" : ""}`}>
        <Money value={value} />
      </dd>
    </>
  )
}

/** Totals and warnings from previewCreditNote. Nothing is computed here. */
function PreviewPanel({
  state,
  pending,
  refundAmount,
}: {
  state: CreditNotePreviewState
  pending: boolean
  refundAmount: MoneyValue | null
}) {
  return (
    <section
      aria-labelledby="credit-totals"
      aria-busy={pending || undefined}
      className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="credit-totals" className="text-sm font-semibold">
          Totals
        </h2>
        {pending ? (
          <span className="text-xs text-fg-secondary">Updating…</span>
        ) : null}
      </div>
      {state.status === "incomplete" ? (
        <p className="text-sm text-fg-secondary">
          Totals appear once you enter what to credit.
        </p>
      ) : state.status === "error" ? (
        <p className="text-sm text-danger">{state.message}</p>
      ) : (
        <>
          {state.preview.warnings.map((w) => (
            <p
              key={w}
              className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
            >
              <TriangleAlertIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
              />
              {w}
            </p>
          ))}
          {refundAmount !== null ? (
            // Equality only: both amounts come from the services.
            state.preview.total === refundAmount ? (
              <StatusChip tone="success" dot>
                Matches the refund
              </StatusChip>
            ) : (
              <StatusChip tone="warning" dot>
                Doesn&apos;t match the refund of{" "}
                <Money value={refundAmount} className="text-warning" />
              </StatusChip>
            )
          ) : null}
          <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Taxable value" value={state.preview.taxable} />
            {isIntrastate(state.preview.supplyType) ? (
              <>
                <Row label="CGST" value={state.preview.cgst} />
                <Row label="SGST" value={state.preview.sgst} />
              </>
            ) : (
              <Row label="IGST" value={state.preview.igst} />
            )}
            {state.preview.roundOff !== 0n ? (
              <Row label="Round-off" value={state.preview.roundOff} />
            ) : null}
            <Row label="Credit note total" value={state.preview.total} strong />
            <Row
              label={`Owed on ${state.preview.invoice.number} after`}
              value={state.preview.invoice.outstandingAfter}
            />
          </dl>
        </>
      )}
    </section>
  )
}
