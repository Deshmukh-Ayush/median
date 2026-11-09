import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { LockIcon } from "lucide-react"

import { idSchema } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"

import { CreditNoteForm } from "@/components/invoices/credit-note-form"
import { todayIso } from "@/lib/format-date"
import type { PagePropsWith } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { getInvoice } from "@/server/services"

import { getPageContext } from "../../../org-context"

export const metadata: Metadata = { title: "New credit note · Median" }

export default async function Page({ params }: PagePropsWith<{ id: string }>) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  const { ctx, allowed } = await getPageContext("/invoices")
  if (!allowed) notFound()
  const invoice = await getInvoice(ctx, id)
  if (!invoice) notFound()

  const title = `Credit note for ${invoice.number}`
  const back = (
    <Link
      href={`/invoices/${invoice.id}`}
      className={buttonVariants({ size: "sm" })}
    >
      Back to invoice
    </Link>
  )

  if (!can(ctx.role, { resource: "ledger", action: "post" })) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title={title} />
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<LockIcon />}
            title="You can't issue credit notes"
            description="A credit note posts to the books. Ask an owner or finance member."
            action={back}
          />
        </div>
      </div>
    )
  }

  if (invoice.status === "cancelled") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title={title} />
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            title="This invoice is cancelled"
            description="There's nothing left to credit."
            action={back}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={title}
        description={`${invoice.party.name}. Tax and totals are worked out when you issue it, the same way as the invoice.`}
      />
      <CreditNoteForm
        invoiceId={invoice.id}
        lines={invoice.lines.map((l) => ({
          id: l.id,
          description: l.description,
          hsnSac: l.hsnSac,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxable: l.taxable,
          gstRateBps: l.gstRateBps,
        }))}
        today={todayIso()}
      />
    </div>
  )
}
