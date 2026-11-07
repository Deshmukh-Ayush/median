"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import { startTransition, useActionState, useState } from "react"
import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

import { createInvoiceFromForm } from "@/app/(app)/invoices/new/actions"
import type { InvoiceFormState } from "@/app/(app)/invoices/new/actions"
import { FormError } from "@/components/forms/field"

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
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const percent = (bps: number) => `${bps / 100}%`

export function InvoiceBuilder({
  customers,
  states,
  orgStateCode,
  slabPeriods,
  today,
}: {
  customers: readonly Customer[]
  states: readonly { code: string; name: string }[]
  orgStateCode: string | null
  slabPeriods: readonly SlabPeriod[]
  today: string
}) {
  const [state, action, pending] = useActionState(
    createInvoiceFromForm,
    INITIAL
  )
  const errors = state.fieldErrors ?? {}

  const first = customers[0]
  const [partyId, setPartyId] = useState(first?.id ?? "")
  const [placeOfSupply, setPlaceOfSupply] = useState(
    first?.stateCode ?? orgStateCode ?? ""
  )
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueDate, setDueDate] = useState(addDays(today, 30))
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
  // A label only: the backend decides the supply type on create.
  const expectedSupply =
    !orgStateCode || !placeOfSupply
      ? null
      : placeOfSupply === orgStateCode
        ? "Intra-state: CGST + SGST"
        : "Inter-state: IGST"

  function chooseCustomer(id: string) {
    setPartyId(id)
    const stateCode = customers.find((c) => c.id === id)?.stateCode
    if (stateCode) setPlaceOfSupply(stateCode)
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
      onSubmit={(event) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        formData.set(
          "lines",
          JSON.stringify(lines.map(({ key: _key, ...line }) => line))
        )
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
          hint={
            expectedSupply ??
            "Set your state in GST details to see the supply type."
          }
        >
          <option value="">Choose a state</option>
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code} · {s.name}
            </option>
          ))}
        </SelectField>

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
          onChange={setDueDate}
          error={err("dueDate")}
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

      {/* Header fields travel as named inputs; lines as JSON. */}
      <input type="hidden" name="partyId" value={partyId} />
      <input type="hidden" name="placeOfSupply" value={placeOfSupply} />
      <input type="hidden" name="invoiceDate" value={invoiceDate} />
      <input type="hidden" name="dueDate" value={dueDate} />

      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          Create invoice
        </Button>
        <p className="text-xs text-fg-secondary">
          This posts the invoice to the books and gives it the next number.
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
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
  hint?: string
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
        className={SELECT}
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
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
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
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
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
