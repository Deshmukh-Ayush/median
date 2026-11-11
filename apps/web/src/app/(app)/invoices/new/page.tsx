import type { Metadata } from "next"
import Link from "next/link"
import { LockIcon } from "lucide-react"

import { GST_SLAB_PERIODS, GST_STATES } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"

import { InvoiceBuilder } from "@/components/invoices/invoice-builder"
import type { SlabPeriod } from "@/components/invoices/invoice-builder"
import { todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { idParam } from "@/lib/report-params"
import {
  GST_RATES_BPS,
  getDefaultPaymentTerms,
  getGstProfile,
  listParties,
} from "@/server/services"

import { getPageContext } from "../../org-context"

export const metadata: Metadata = { title: "New invoice · Median" }

const STATES = GST_STATES.filter((s) => s.active).map((s) => ({
  code: s.code,
  name: s.name,
}))

// Slabs by invoice date, limited to rates createInvoice accepts today.
const ACCEPTED = new Set<number>(GST_RATES_BPS)
const SLAB_PERIODS: readonly SlabPeriod[] = GST_SLAB_PERIODS.map((p) => ({
  effectiveFrom: p.effectiveFrom,
  effectiveTo: p.effectiveTo,
  slabsBps: p.slabsBps.filter((r) => ACCEPTED.has(r)),
}))

/** Adds a customer, then comes back here with them picked. */
const NEW_CUSTOMER = `/parties/new?kind=customer&next=${encodeURIComponent("/invoices/new")}`

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/invoices"),
    searchParams,
  ])
  if (!allowed || !can(ctx.role, { resource: "ledger", action: "post" })) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="New invoice" />
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<LockIcon />}
            title="You can't raise invoices"
            description="Raising an invoice posts it to the books. Ask an owner or finance member."
          />
        </div>
      </div>
    )
  }

  const [customers, profile, defaultTermsDays] = await Promise.all([
    listParties(ctx, null, { kind: "customer" }, { limit: 100 }),
    getGstProfile(ctx),
    getDefaultPaymentTerms(ctx),
  ])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="New invoice"
        description="Tax and totals are worked out when you create it, from the place of supply and each line's rate."
        actions={
          <Link href={NEW_CUSTOMER} className={buttonVariants({ size: "sm" })}>
            New customer
          </Link>
        }
      />
      {customers.items.length === 0 ? (
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            title="No customers yet"
            description="Add the customer you're billing, or import your sales from Tally."
            action={
              <Link
                href={NEW_CUSTOMER}
                className={buttonVariants({ variant: "primary", size: "sm" })}
              >
                Add a customer
              </Link>
            }
          />
        </div>
      ) : (
        <InvoiceBuilder
          customers={customers.items.map((p) => ({
            id: p.id,
            name: p.name,
            gstin: p.gstin,
            stateCode: p.stateCode,
            paymentTermsDays: p.paymentTermsDays,
          }))}
          states={STATES}
          orgStateCode={profile.stateCode}
          defaultTermsDays={defaultTermsDays}
          slabPeriods={SLAB_PERIODS}
          today={todayIso()}
          initialCustomerId={idParam(params.customer)}
        />
      )}
    </div>
  )
}
