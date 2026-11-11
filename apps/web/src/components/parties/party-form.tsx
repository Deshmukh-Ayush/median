"use client"

import { useActionState } from "react"

import type { Party, PartyKind } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

import {
  createPartyFromForm,
  updatePartyFromForm,
} from "@/app/(app)/parties/actions"
import { Field, FormError } from "@/components/forms/field"
import { EMPTY_FORM_STATE } from "@/lib/form-state"

export interface StateOption {
  readonly code: string
  readonly name: string
}

const REGISTRATION = [
  ["regular", "Regular (GSTIN)"],
  ["composition", "Composition (GSTIN)"],
  ["sez", "SEZ unit (GSTIN)"],
  ["unregistered", "Unregistered"],
  ["overseas", "Overseas"],
] as const

const TDS = ["194C", "194H", "194I(a)", "194I(b)", "194J(a)", "194J(b)", "194Q"]

const SELECT =
  "h-8 rounded-sm border border-input bg-surface px-2 text-sm disabled:opacity-60 aria-invalid:border-danger"

function Select({
  name,
  label,
  hint,
  error,
  children,
  ...props
}: React.ComponentProps<"select"> & {
  name: string
  label: string
  hint?: string
  error?: string | undefined
}) {
  const id = `field-${name}`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        className={SELECT}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-fg-secondary">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * Create or edit a customer or vendor. State and PAN come from the GSTIN on
 * the server. When the party is in use, the fields printed on its documents
 * are locked (disabled inputs aren't submitted, so they stay as they are).
 */
export function PartyForm({
  kind,
  party,
  locked = false,
  states,
  next,
  today,
}: {
  kind: PartyKind
  party?: Party
  locked?: boolean
  states: readonly StateOption[]
  next?: string
  today: string
}) {
  const [state, action, pending] = useActionState(
    party ? updatePartyFromForm : createPartyFromForm,
    EMPTY_FORM_STATE
  )
  const v = (key: keyof Party): string => {
    const fromState = state.values?.[key]
    if (fromState !== undefined) return fromState
    const stored = party?.[key]
    return stored === null || stored === undefined ? "" : String(stored)
  }
  const err = (key: string) => state.fieldErrors?.[key]
  const noun = kind === "customer" ? "customer" : "vendor"

  return (
    <form
      action={action}
      className="flex max-w-2xl flex-col gap-5 rounded-lg border border-default bg-surface p-5"
    >
      <input type="hidden" name="kind" value={kind} />
      {party ? <input type="hidden" name="id" value={party.id} /> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Name and GST</h2>
        {locked ? (
          <p className="text-xs text-fg-secondary">
            This {noun} has invoices or entries, so the details printed on them
            can&apos;t change. Archive it and add a new one if they have.
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="name"
            label="Name"
            required
            maxLength={200}
            disabled={locked}
            defaultValue={v("name")}
            error={err("name")}
          />
          <Field
            name="legalName"
            label="Legal name"
            hint="As on their GST certificate or PAN, if different."
            maxLength={200}
            disabled={locked}
            defaultValue={v("legalName")}
            error={err("legalName")}
          />
          <Select
            name="registrationType"
            label="GST registration"
            disabled={locked}
            defaultValue={v("registrationType")}
            error={err("registrationType")}
          >
            {party ? null : (
              <option value="">Work it out from the GSTIN</option>
            )}
            {REGISTRATION.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Field
            name="gstin"
            label="GSTIN"
            placeholder="27AAPCA1234F1ZV"
            maxLength={15}
            autoComplete="off"
            inputClassName="font-mono"
            disabled={locked}
            defaultValue={v("gstin")}
            error={err("gstin")}
            hint="We check it for typos and fill in the state and PAN."
          />
          <Select
            name="stateCode"
            label="State"
            disabled={locked}
            defaultValue={v("stateCode")}
            error={err("stateCode")}
            hint="Decides CGST + SGST or IGST. Taken from the GSTIN when there is one."
          >
            <option value="">Not in India / from GSTIN</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </Select>
          <Field
            name="pan"
            label="PAN"
            placeholder="AAPCA1234F"
            maxLength={10}
            autoComplete="off"
            readOnly={Boolean(party?.gstin)}
            inputClassName={party?.gstin ? "bg-hover text-fg-secondary" : ""}
            defaultValue={v("pan")}
            error={err("pan")}
            hint="Filled from the GSTIN. Needed for TDS."
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Contact and terms</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="field-billingAddress">Billing address</Label>
          <Textarea
            id="field-billingAddress"
            name="billingAddress"
            rows={2}
            maxLength={500}
            defaultValue={v("billingAddress")}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            name="email"
            label="Email"
            type="email"
            defaultValue={v("email")}
            error={err("email")}
          />
          <Field
            name="phone"
            label="Phone"
            maxLength={20}
            defaultValue={v("phone")}
            error={err("phone")}
          />
          <Field
            name="paymentTermsDays"
            label="Payment terms (days)"
            inputMode="numeric"
            pattern="\d{1,3}"
            placeholder="Org default"
            defaultValue={v("paymentTermsDays")}
            error={err("paymentTermsDays")}
          />
        </div>
      </section>

      {kind === "vendor" ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">TDS and MSME</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              name="defaultTdsSection"
              label="Usual TDS section"
              defaultValue={v("defaultTdsSection")}
              error={err("defaultTdsSection")}
            >
              <option value="">None</option>
              {TDS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select
              name="msmeCategory"
              label="MSME"
              defaultValue={v("msmeCategory")}
              error={err("msmeCategory")}
              hint="Micro and small must be paid within 45 days (43B(h))."
            >
              <option value="">Not MSME</option>
              <option value="micro">Micro</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
            </Select>
            <Field
              name="udyamNumber"
              label="Udyam number"
              placeholder="UDYAM-MH-01-0001234"
              maxLength={19}
              autoComplete="off"
              defaultValue={v("udyamNumber")}
              error={err("udyamNumber")}
            />
          </div>
        </section>
      ) : null}

      {party ? null : (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Opening balance (optional)</h2>
          <p className="text-xs text-fg-secondary">
            What was outstanding on the day your books in Median start. It posts
            against Opening balance equity and can be reversed.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              name="obAmount"
              label="Amount (₹)"
              inputMode="decimal"
              placeholder="0.00"
              inputClassName="font-mono tabular-nums"
              defaultValue={state.values?.obAmount}
              error={err("obAmount")}
            />
            <Select
              name="obDirection"
              label="Who owes whom"
              defaultValue={
                state.values?.obDirection ??
                (kind === "customer" ? "owed_to_us" : "owed_by_us")
              }
            >
              <option value="owed_to_us">They owe us</option>
              <option value="owed_by_us">We owe them</option>
            </Select>
            <Field
              name="obDate"
              label="As of"
              type="date"
              defaultValue={state.values?.obDate ?? today}
              error={err("obDate")}
            />
          </div>
        </section>
      )}

      <FormError message={state.error} />
      <Button
        type="submit"
        variant="primary"
        loading={pending}
        className="self-start"
      >
        {party ? "Save changes" : `Add ${noun}`}
      </Button>
    </form>
  )
}
