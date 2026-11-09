import Link from "next/link"
import { FileTextIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { IsoDate } from "@workspace/contracts"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Money } from "@workspace/ui/components/money"
import { StatusChip } from "@workspace/ui/components/status-chip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { formatDate } from "@/lib/format-date"
import { INVOICE_STATUS } from "@/lib/invoices"
import { listInvoices } from "@/server/services"
import type { OrgContext } from "@/server/services"

/** Invoices newest first, with what's still owed on each. */
export async function InvoiceList({
  ctx,
  cursor,
  customerId,
  today,
  hrefFor,
}: {
  ctx: OrgContext
  cursor: string | null
  customerId: string | undefined
  today: IsoDate
  hrefFor: (p: { cursor?: string | null; customer?: string | null }) => string
}) {
  let page
  try {
    page = await listInvoices(ctx, cursor, { partyId: customerId })
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<FileTextIcon />}
          title="We couldn't load your invoices"
          description={error.message}
        />
      </div>
    )
  }

  if (page.items.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<FileTextIcon />}
          title={cursor ? "No more invoices" : "No invoices yet"}
          description={
            customerId
              ? "This customer has no invoices."
              : "Invoices you create show up here, with who owes what."
          }
          action={
            cursor || customerId ? (
              <Link
                href={hrefFor({ cursor: null, customer: null })}
                className={buttonVariants({ size: "sm" })}
              >
                All invoices
              </Link>
            ) : (
              <Link
                href="/invoices/new"
                className={buttonVariants({ size: "sm" })}
              >
                New invoice
              </Link>
            )
          }
        />
      </div>
    )
  }

  const customer = customerId
    ? page.items.find((i) => i.party.id === customerId)?.party
    : undefined

  return (
    <section aria-labelledby="invoices" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="invoices" className="text-sm font-semibold">
          {customer ? `Invoices to ${customer.name}` : "Invoices"}
        </h2>
        {customerId ? (
          <Link
            href={hrefFor({ cursor: null, customer: null })}
            className="text-xs text-fg-secondary hover:underline"
          >
            Show all customers
          </Link>
        ) : null}
      </div>
      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Due</TableHead>
              <TableHead numeric>Total</TableHead>
              <TableHead numeric>Owed</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((inv) => {
              const status = INVOICE_STATUS[inv.status]
              const overdue = inv.outstanding > 0n && inv.dueDate < today
              return (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-medium tabular hover:underline"
                    >
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={hrefFor({ cursor: null, customer: inv.party.id })}
                      className="hover:underline"
                    >
                      {inv.party.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-fg-secondary tabular">
                    {formatDate(inv.invoiceDate)}
                  </TableCell>
                  <TableCell className="text-fg-secondary tabular">
                    {formatDate(inv.dueDate)}
                  </TableCell>
                  <TableCell numeric>
                    <Money value={inv.total} />
                  </TableCell>
                  <TableCell numeric>
                    {inv.outstanding > 0n ? (
                      <Money
                        value={inv.outstanding}
                        tone={overdue ? "danger" : "default"}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {overdue && inv.status !== "cancelled" ? (
                      <StatusChip tone="danger">Overdue</StatusChip>
                    ) : (
                      <StatusChip tone={status.tone}>{status.label}</StatusChip>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {cursor || page.nextCursor ? (
        <nav aria-label="Invoice pages" className="flex justify-end gap-2">
          {cursor ? (
            <Link
              href={hrefFor({ cursor: null })}
              className={buttonVariants({ size: "sm" })}
            >
              First page
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link
              href={hrefFor({ cursor: page.nextCursor })}
              className={buttonVariants({ size: "sm" })}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  )
}
