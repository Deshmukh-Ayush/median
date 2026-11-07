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
import { can } from "@/lib/permissions"
import { GST_RATES_BPS, getGstProfile, listParties } from "@/server/services"

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

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/invoices")
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

  const [customers, profile] = await Promise.all([
    listParties(ctx, null, { kind: "customer" }, { limit: 100 }),
    getGstProfile(ctx),
  ])

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="New invoice"
        description="Tax and totals are worked out when you create it, from the place of supply and each line's rate."
      />
      {customers.items.length === 0 ? (
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            title="No customers yet"
            description="Customers appear here once you've added them or imported sales."
            action={
              <Link href="/invoices" className={buttonVariants({ size: "sm" })}>
                Back to invoices
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
          }))}
          states={STATES}
          orgStateCode={profile.stateCode}
          slabPeriods={SLAB_PERIODS}
          today={todayIso()}
        />
      )}
    </div>
  )
}
