import Link from "next/link"
import { ClockIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { AgeingBuckets } from "@workspace/contracts"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Money } from "@workspace/ui/components/money"
import { StatCard } from "@workspace/ui/components/stat-card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { formatDate } from "@/lib/format-date"
import { getReceivablesAgeing } from "@/server/services"
import type { OrgContext } from "@/server/services"
import { ExcelLink } from "@/components/reports/excel-link"
import { can } from "@/lib/permissions"

const BUCKETS: readonly {
  key: Exclude<keyof AgeingBuckets, "total">
  label: string
  /** 61+ days: worth chasing, shown in red. */
  late: boolean
}[] = [
  { key: "notDue", label: "Not due", late: false },
  { key: "days1To30", label: "1–30 days", late: false },
  { key: "days31To60", label: "31–60 days", late: false },
  { key: "days61To90", label: "61–90 days", late: true },
  { key: "over90", label: "90+ days", late: true },
]

/** Money owed to you by how late it is, overall and by customer. */
export async function ReceivablesAgeing({
  ctx,
  cursor,
  hrefFor,
}: {
  ctx: OrgContext
  cursor: string | null
  /** Builds this page's URL with the given ageing cursor and customer. */
  hrefFor: (p: { ageing?: string | null; customer?: string | null }) => string
}) {
  let ageing
  try {
    ageing = await getReceivablesAgeing(ctx, cursor)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<ClockIcon />}
          title="We couldn't load what you're owed"
          description={error.message}
        />
      </div>
    )
  }

  const { totals } = ageing
  if (totals.total === 0n) {
    return (
      <p className="rounded-lg border border-default bg-surface px-4 py-3 text-sm text-fg-secondary">
        Nothing is owed to you right now.
      </p>
    )
  }

  return (
    <section aria-labelledby="ageing" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ageing" className="text-sm font-semibold">
          Owed to you
        </h2>
        <span className="flex items-baseline gap-2 text-xs text-fg-secondary">
          Days past due, as of {formatDate(ageing.asOf)}
          {can(ctx.role, { resource: "report", action: "export" }) ? (
            <ExcelLink params={{ report: "receivables_ageing" }} />
          ) : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {BUCKETS.map((b) => (
          <StatCard
            key={b.key}
            label={b.label}
            value={totals[b.key]}
            compact
            tone={b.late && totals[b.key] > 0n ? "danger" : "default"}
          />
        ))}
        <StatCard label="Total owed" value={totals.total} compact />
      </div>

      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <TableHead numeric>Invoices</TableHead>
              {BUCKETS.map((b) => (
                <TableHead key={b.key} numeric>
                  {b.label}
                </TableHead>
              ))}
              <TableHead numeric>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ageing.parties.items.map((p) => (
              <TableRow key={p.party.id}>
                <TableCell>
                  <Link
                    href={hrefFor({ customer: p.party.id })}
                    className="hover:underline"
                  >
                    {p.party.name}
                  </Link>
                </TableCell>
                <TableCell numeric>{p.openInvoices}</TableCell>
                {BUCKETS.map((b) => (
                  <TableCell key={b.key} numeric>
                    {p[b.key] > 0n ? <Money value={p[b.key]} /> : null}
                  </TableCell>
                ))}
                <TableCell numeric className="font-medium">
                  <Money value={p.total} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {ageing.parties.nextCursor || cursor ? null : (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2}>All customers</TableCell>
                {BUCKETS.map((b) => (
                  <TableCell key={b.key} numeric>
                    <Money value={totals[b.key]} />
                  </TableCell>
                ))}
                <TableCell numeric>
                  <Money value={totals.total} />
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      {cursor || ageing.parties.nextCursor ? (
        <nav aria-label="Customer pages" className="flex justify-end gap-2">
          {cursor ? (
            <Link
              href={hrefFor({ ageing: null })}
              className={buttonVariants({ size: "sm" })}
            >
              First customers
            </Link>
          ) : null}
          {ageing.parties.nextCursor ? (
            <Link
              href={hrefFor({ ageing: ageing.parties.nextCursor })}
              className={buttonVariants({ size: "sm" })}
            >
              More customers
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  )
}
