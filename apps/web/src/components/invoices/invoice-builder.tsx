"use client"

import { PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react"
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"

import { GST_EXPORT_PLACE_OF_SUPPLY, dueDateFor } from "@workspace/contracts"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Money } from "@workspace/ui/components/money"
import { Textarea } from "@workspace/ui/components/textarea"

import {
  createInvoiceFromForm,
  previewInvoiceFromForm,
} from "@/app/(app)/invoices/new/actions"
import type {
  InvoiceFormState,
  InvoicePreviewState,
} from "@/app/(app)/invoices/new/actions"
import { FormError } from "@/components/forms/field"
import {
  SPECIAL_SUPPLIES,
  isExport,
  isIntrastate,
  specialSupplyOf,
  supplyLabel,
} from "@/lib/invoices"
import type { SpecialSupply } from "@/lib/invoices"

export interface SlabPeriod {
  effectiveFrom: string | null
  effectiveTo: string | null
  slabsBps: readonly number[]
}

interface Customer {
  id: string
  name: string
  gstin: string | null
  stateCode: string | null
  /** Null → the organisation's default terms. */
  paymentTermsDays: number | null
}

interface LineDraft {
  key: number
  description: string
  hsnSac: string
  quantity: string
  unitPrice: string
  gstRateBps: string
}

const INITIAL: InvoiceFormState = {}
const SELECT =
  "h-8 rounded-sm border border-input bg-surface px-2 text-sm aria-invalid:border-danger"

/** Slabs in force on `date` (YYYY-MM-DD), from the contracts list. */
function slabsOn(periods: readonly SlabPeriod[], date: string) {
  return (
    periods.find(
      (p) =>
        (p.effectiveFrom === null || p.effectiveFrom <= date) &&
        (p.effectiveTo === null || date <= p.effectiveTo)
    )?.slabsBps ?? []
  )
}

/** A calendar date plus whole days, in UTC so time zones can't shift it. */
const percent = (bps: number) => `${bps / 100}%`

/** Wait this long after the last keystroke before asking for a preview. */
const PREVIEW_DELAY_MS = 400

export function InvoiceBuilder({
  customers,
  states,
  orgStateCode,
  defaultTermsDays,
  slabPeriods,
  today,
  initialCustomerId,
}: {
  customers: readonly Customer[]
  states: readonly { code: string; name: string }[]
  orgStateCode: string | null
  /** The organisation's default payment terms, in days. */
  defaultTermsDays: number
  slabPeriods: readonly SlabPeriod[]
  today: string
  /** Picked first, e.g. a customer just added from this form. */
  initialCustomerId?: string | undefined
}) {
  const [state, action, pending] = useActionState(
    createInvoiceFromForm,
    INITIAL
  )
  const errors = state.fieldErrors ?? {}

  const first =
    customers.find((c) => c.id === initialCustomerId) ?? customers[0]
  const [partyId, setPartyId] = useState(first?.id ?? "")
  const [placeOfSupply, setPlaceOfSupply] = useState(
    first?.stateCode ?? orgStateCode ?? ""
  )
  const termsOf = (id: string) =>
    customers.find((c) => c.id === id)?.paymentTermsDays ?? defaultTermsDays
  const [invoiceDate, setInvoiceDate] = useState(today)
  // The due date follows the invoice date and the customer's terms until
  // someone sets it by hand.
  const [dueDate, setDueDate] = useState(
    dueDateFor(today, termsOf(first?.id ?? ""))
  )
  const [dueDateByHand, setDueDateByHand] = useState(false)
  const [specialSupply, setSpecialSupply] = useState<SpecialSupply | null>(null)
  const [reverseCharge, setReverseCharge] = useState(false)
  const [nextKey, setNextKey] = useState(1)
  const rates = slabsOn(slabPeriods, invoiceDate)
  const defaultRate = String(rates.includes(1800) ? 1800 : (rates[0] ?? 0))
  const [lines, setLines] = useState<LineDraft[]>([
    {
      key: 0,
      description: "",
      hsnSac: "",
      quantity: "1",
      unitPrice: "",
      gstRateBps: defaultRate,
    },
  ])

  const customer = customers.find((c) => c.id === partyId)
  const exporting = isExport(specialSupply)

  // Live preview from previewInvoice: the UI never adds anything up. Only
  // the newest response is shown, so a slow one can't overwrite a newer one.
  const formRef = useRef<HTMLFormElement>(null)
  const latest = useRef(0)
  const [preview, setPreview] = useState<InvoicePreviewState>({
    status: "incomplete",
  })
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    const request = ++latest.current
    const timer = setTimeout(() => {
      setPreviewing(true)
      previewInvoiceFromForm(formDataOf(form, lines))
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
  }, [
    partyId,
    placeOfSupply,
    specialSupply,
    reverseCharge,
    invoiceDate,
    dueDate,
    lines,
  ])
  const ready = preview.status === "ready" ? preview.preview : null

  function chooseCustomer(id: string) {
    setPartyId(id)
    if (!dueDateByHand) setDueDate(dueDateFor(invoiceDate, termsOf(id)))
    const stateCode = customers.find((c) => c.id === id)?.stateCode
    if (stateCode && !exporting) setPlaceOfSupply(stateCode)
  }

  function chooseSpecialSupply(value: string) {
    const next = specialSupplyOf(value)
    setSpecialSupply(next)
    if (isExport(next)) setPlaceOfSupply(GST_EXPORT_PLACE_OF_SUPPLY)
    else if (placeOfSupply === GST_EXPORT_PLACE_OF_SUPPLY)
      setPlaceOfSupply(customer?.stateCode ?? orgStateCode ?? "")
  }

  function setLine(key: number, patch: Partial<LineDraft>) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((all) => [
      ...all,
      {
        key: nextKey,
        description: "",
        hsnSac: all.at(-1)?.hsnSac ?? "",
        quantity: "1",
        unitPrice: "",
        gstRateBps: all.at(-1)?.gstRateBps ?? defaultRate,
      },
    ])
    setNextKey((k) => k + 1)
  }

  // A rate that isn't a slab on the new date is cleared to the default.
  function changeInvoiceDate(date: string) {
    setInvoiceDate(date)
    if (!dueDateByHand) setDueDate(dueDateFor(date, termsOf(partyId)))
    const allowed = slabsOn(slabPeriods, date).map(String)
    setLines((all) =>
      all.map((l) =>
        allowed.includes(l.gstRateBps)
          ? l
          : {
              ...l,
              gstRateBps: allowed.includes("1800")
                ? "1800"
                : (allowed[0] ?? "0"),
            }
      )
    )
  }

  const err = (key: string) => errors[key]

  return (
    <form
      // Not action={action}: React resets a form after its action, which
      // would drop the controlled selects back to their first options.
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault()
        const formData = formDataOf(event.currentTarget, lines)
        startTransition(() => action(formData))
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      <section className="grid gap-4 rounded-lg border border-default bg-surface p-5 sm:grid-cols-2">
        <SelectField
          id="partyId"
          label="Customer"
          value={partyId}
          onChange={chooseCustomer}
          error={err("partyId")}
          hint={
            customer?.gstin
              ? `GSTIN ${customer.gstin}`
              : "No GSTIN: a B2C invoice."
          }
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          id="placeOfSupply"
          label="Place of supply"
          value={placeOfSupply}
          onChange={setPlaceOfSupply}
          error={err("placeOfSupply")}
          disabled={exporting}
          hint={
            ready
              ? supplyLabel(ready.supplyType)
              : "The supply type shows once the invoice is filled in."
          }
        >
          <option value="">Choose a state</option>
          {exporting ? (
            <option value={GST_EXPORT_PLACE_OF_SUPPLY}>
              {GST_EXPORT_PLACE_OF_SUPPLY} · Outside India
            </option>
          ) : null}
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} · {s.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          id="specialSupply"
          label="Export or SEZ"
          value={specialSupply ?? ""}
          onChange={chooseSpecialSupply}
          error={err("specialSupply")}
          hint="Exports are placed outside India (96)."
        >
          {SPECIAL_SUPPLIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reverse charge</span>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reverseCharge}
              onChange={(e) => setReverseCharge(e.target.checked)}
              className="size-4"
            />
            The customer pays the GST
          </label>
          <p className="text-xs text-fg-secondary">
            For services notified under reverse charge.
          </p>
        </div>

        <DateField
          id="invoiceDate"
          label="Invoice date"
          value={invoiceDate}
          onChange={changeInvoiceDate}
          error={err("invoiceDate")}
        />
        <DateField
          id="dueDate"
          label="Due date"
          value={dueDate}
          onChange={(date) => {
            setDueDate(date)
            setDueDateByHand(true)
          }}
          error={err("dueDate")}
          hint={
            dueDateByHand ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setDueDateByHand(false)
                  setDueDate(dueDateFor(invoiceDate, termsOf(partyId)))
                }}
              >
                Use the {termsOf(partyId)}-day terms again
              </button>
            ) : customer?.paymentTermsDays != null ? (
              `${customer.paymentTermsDays} days: ${customer.name}'s terms`
            ) : (
              `${defaultTermsDays} days: your default terms`
            )
          }
        />
      </section>

      <section
        aria-labelledby="invoice-lines"
        className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5"
      >
        <h2 id="invoice-lines" className="text-sm font-semibold">
          Lines
        </h2>
        {err("lines") ? (
          <p className="text-xs text-danger">{err("lines")}</p>
        ) : null}
        <ol className="flex flex-col gap-4">
          {lines.map((line, index) => {
            const at = (field: string) => err(`lines.${index}.${field}`)
            const id = (field: string) => `line-${line.key}-${field}`
            return (
              <li
                key={line.key}
                className="grid gap-3 border-t border-default pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,3fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto]"
              >
                <LineInput
                  id={id("description")}
                  label="Description"
                  value={line.description}
                  onChange={(v) => setLine(line.key, { description: v })}
                  error={at("description")}
                  placeholder="Growth plan, annual"
                />
                <LineInput
                  id={id("hsnSac")}
                  label="HSN/SAC"
                  value={line.hsnSac}
                  onChange={(v) => setLine(line.key, { hsnSac: v })}
                  error={at("hsnSac")}
                  inputMode="numeric"
                  placeholder="998314"
                />
                <LineInput
                  id={id("quantity")}
                  label="Qty"
                  value={line.quantity}
                  onChange={(v) => setLine(line.key, { quantity: v })}
                  error={at("quantity")}
                  inputMode="decimal"
                />
                <LineInput
                  id={id("unitPrice")}
                  label="Unit price (₹)"
                  value={line.unitPrice}
                  onChange={(v) => setLine(line.key, { unitPrice: v })}
                  error={at("unitPrice")}
                  inputMode="decimal"
                  placeholder="1,00,000.00"
                />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={id("rate")}>GST rate</Label>
                  <select
                    id={id("rate")}
                    value={line.gstRateBps}
                    onChange={(e) =>
                      setLine(line.key, { gstRateBps: e.target.value })
                    }
                    aria-invalid={at("gstRateBps") ? true : undefined}
                    className={SELECT}
                  >
                    {rates.map((r) => (
                      <option key={r} value={String(r)}>
                        {percent(r)}
                      </option>
                    ))}
                  </select>
                  {at("gstRateBps") ? (
                    <p className="text-xs text-danger">{at("gstRateBps")}</p>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((all) => all.filter((l) => l.key !== line.key))
                    }
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
                <LinePreview
                  line={ready?.lines[index]}
                  intrastate={ready ? isIntrastate(ready.supplyType) : true}
                />
              </li>
            )
          })}
        </ol>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={addLine}
          disabled={lines.length >= 100}
        >
          <PlusIcon aria-hidden />
          Add line
        </Button>
      </section>

      <section className="flex flex-col gap-1.5 rounded-lg border border-default bg-surface p-5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={2000}
          placeholder="Thanks for your business."
        />
      </section>

      <PreviewPanel state={preview} pending={previewing} />

      {/* Header fields travel as named inputs; lines as JSON. */}
      <input type="hidden" name="partyId" value={partyId} />
      <input type="hidden" name="placeOfSupply" value={placeOfSupply} />
      <input type="hidden" name="specialSupply" value={specialSupply ?? ""} />
      <input
        type="hidden"
        name="reverseCharge"
        value={reverseCharge ? "on" : ""}
      />
      <input type="hidden" name="invoiceDate" value={invoiceDate} />
      <input type="hidden" name="dueDate" value={dueDate} />

      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          Create invoice
        </Button>
        <p className="text-xs text-fg-secondary">
          This posts the invoice to the books and gives it the next number
          {ready ? ` (${ready.nextNumber})` : ""}.
        </p>
      </div>
    </form>
  )
}

function SelectField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  disabled = false,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
  hint?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-note`}
        disabled={disabled}
        className={`${SELECT} disabled:bg-app disabled:text-fg-secondary`}
      >
        {children}
      </select>
      <p
        id={`${id}-note`}
        className={error ? "text-xs text-danger" : "text-xs text-fg-secondary"}
      >
        {error ?? hint}
      </p>
    </div>
  )
}

function DateField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
  hint?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function LineInput({
  id,
  label,
  value,
  onChange,
  error,
  ...rest
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
  placeholder?: string
  inputMode?: "numeric" | "decimal"
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** The form as the actions read it: named inputs, plus lines as JSON. */
function formDataOf(form: HTMLFormElement, lines: readonly LineDraft[]) {
  const formData = new FormData(form)
  formData.set(
    "lines",
    JSON.stringify(lines.map(({ key: _key, ...line }) => line))
  )
  return formData
}

type Preview = Extract<InvoicePreviewState, { status: "ready" }>["preview"]
type PreviewLine = Preview["lines"][number]

/** One line's taxable value, tax and total, as previewInvoice worked them out. */
function LinePreview({
  line,
  intrastate,
}: {
  line: PreviewLine | undefined
  intrastate: boolean
}) {
  if (!line) return null
  return (
    <p className="flex flex-wrap gap-x-4 text-xs text-fg-secondary sm:col-span-full">
      <span>
        Taxable <Money value={line.taxable} className="text-fg-secondary" />
      </span>
      {intrastate ? (
        <span>
          CGST <Money value={line.cgst} className="text-fg-secondary" /> · SGST{" "}
          <Money value={line.sgst} className="text-fg-secondary" />
        </span>
      ) : (
        <span>
          IGST <Money value={line.igst} className="text-fg-secondary" />
        </span>
      )}
      <span>
        Line total <Money value={line.total} />
      </span>
    </p>
  )
}

function PreviewRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: Preview["total"]
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

/** Totals and warnings from previewInvoice. Nothing here is computed. */
function PreviewPanel({
  state,
  pending,
}: {
  state: InvoicePreviewState
  pending: boolean
}) {
  return (
    <section
      aria-labelledby="invoice-totals"
      aria-busy={pending || undefined}
      className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="invoice-totals" className="text-sm font-semibold">
          Totals
        </h2>
        {pending ? (
          <span className="text-xs text-fg-secondary">Updating…</span>
        ) : null}
      </div>
      {state.status === "incomplete" ? (
        <p className="text-sm text-fg-secondary">
          Totals appear once every line has a description, HSN/SAC, quantity and
          price.
        </p>
      ) : state.status === "error" ? (
        <p className="text-sm text-danger">{state.message}</p>
      ) : (
        <>
          {state.preview.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {state.preview.warnings.map((w) => (
                <li
                  key={w}
                  className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning"
                >
                  <TriangleAlertIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0"
                  />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-fg-secondary">
            {supplyLabel(state.preview.supplyType)}
            {state.preview.reverseCharge
              ? " · reverse charge: the customer pays the GST"
              : ""}
            {state.preview.chargesGst ? "" : " · no GST charged"}
          </p>
          <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <PreviewRow label="Taxable value" value={state.preview.taxable} />
            {isIntrastate(state.preview.supplyType) ? (
              <>
                <PreviewRow label="CGST" value={state.preview.cgst} />
                <PreviewRow label="SGST" value={state.preview.sgst} />
              </>
            ) : (
              <PreviewRow label="IGST" value={state.preview.igst} />
            )}
            {state.preview.roundOff !== 0n ? (
              <PreviewRow label="Round-off" value={state.preview.roundOff} />
            ) : null}
            <PreviewRow label="Total" value={state.preview.total} strong />
          </dl>
        </>
      )}
    </section>
  )
}
