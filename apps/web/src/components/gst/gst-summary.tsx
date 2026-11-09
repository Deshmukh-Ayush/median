import { PercentIcon, TriangleAlertIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type {
  GstSupplyCategory,
  GstSupplyRow,
  GstTaxAmounts,
  Period,
} from "@workspace/contracts"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Money } from "@workspace/ui/components/money"
import { StatusChip } from "@workspace/ui/components/status-chip"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { formatPeriod } from "@/lib/format-date"
import { getGstSummary } from "@/server/services"
import type { OrgContext } from "@/server/services"

const CATEGORY_LABELS: Record<GstSupplyCategory, string> = {
  taxable: "Taxable sales",
  export_with_payment: "Exports, IGST paid",
  export_lut: "Exports under LUT (no IGST)",
  sez: "Supplies to SEZ",
  reverse_charge: "Reverse charge (customer pays the GST)",
  no_invoice: "Sales without an invoice",
}

const rowLabel = (r: GstSupplyRow) =>
  `${CATEGORY_LABELS[r.category]} at ${r.rateBps / 100}%`

function TaxCells({
  t,
  ledger = false,
}: {
  t: GstTaxAmounts
  ledger?: boolean
}) {
  const variant = ledger ? "ledger" : "default"
  return (
    <>
      <TableCell numeric>
        <Money value={t.igst} variant={variant} />
      </TableCell>
      <TableCell numeric>
        <Money value={t.cgst} variant={variant} />
      </TableCell>
      <TableCell numeric>
        <Money value={t.sgst} variant={variant} />
      </TableCell>
      <TableCell numeric className="font-medium">
        <Money value={t.total} variant={variant} />
      </TableCell>
    </>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={7} className="h-9 pt-3 font-medium">
        {children}
      </TableCell>
    </TableRow>
  )
}

function SupplyRows({
  rows,
  empty,
}: {
  rows: readonly GstSupplyRow[]
  empty: string
}) {
  if (rows.length === 0) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={7} className="pl-6 text-fg-tertiary">
          {empty}
        </TableCell>
      </TableRow>
    )
  }
  return rows.map((r) => (
    <TableRow key={`${r.category}:${r.rateBps}`}>
      <TableCell className="pl-6">{rowLabel(r)}</TableCell>
      <TableCell numeric className="text-fg-secondary">
        {r.documentCount || "—"}
      </TableCell>
      <TableCell numeric>
        <Money value={r.taxable} />
      </TableCell>
      <TaxCells t={r} />
    </TableRow>
  ))
}

/** GSTR-3B style summary for a month. Every amount is the service's. */
export async function GstSummaryView({
  ctx,
  period,
}: {
  ctx: OrgContext
  period: Period
}) {
  let s
  try {
    s = await getGstSummary(ctx, period)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<PercentIcon />}
          title="We couldn't load the GST summary"
          description={error.message}
        />
      </div>
    )
  }

  const carried = s.creditCarriedForward.total > 0n
  const unexplained = s.unexplainedOutputTax.total !== 0n

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-default bg-surface px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            Tax to pay in cash for {formatPeriod(s.period)}
            {s.isLocked ? (
              <StatusChip tone="success">Locked</StatusChip>
            ) : (
              <StatusChip tone="warning">Open: can still change</StatusChip>
            )}
          </span>
          <Money
            value={s.netPayable.total}
            className="text-2xl font-semibold"
          />
          {carried ? (
            <span className="text-xs text-fg-secondary">
              <Money
                value={s.creditCarriedForward.total}
                className="text-fg-secondary"
              />{" "}
              input tax credit carried to next month
            </span>
          ) : null}
        </div>
        <dl className="flex gap-6 text-sm">
          {(["igst", "cgst", "sgst"] as const).map((head) => (
            <div key={head} className="flex flex-col gap-0.5">
              <dt className="text-xs text-fg-secondary uppercase">{head}</dt>
              <dd>
                <Money value={s.netPayable[head]} className="font-medium" />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {s.warnings.length > 0 || unexplained ? (
        <ul className="flex flex-col gap-1.5">
          {unexplained ? (
            <li className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning">
              <TriangleAlertIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                <Money
                  value={s.unexplainedOutputTax.total}
                  className="text-warning"
                />{" "}
                of output GST in the books isn&apos;t explained by an invoice,
                credit note or sale (e.g. a manual entry). Check it before
                filing.
              </span>
            </li>
          ) : null}
          {s.warnings.map((w) => (
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

      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>GSTR-3B</TableHead>
              <TableHead numeric className="w-16">
                Docs
              </TableHead>
              <TableHead numeric>Taxable value</TableHead>
              <TableHead numeric>IGST</TableHead>
              <TableHead numeric>CGST</TableHead>
              <TableHead numeric>SGST</TableHead>
              <TableHead numeric>Total tax</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Heading>Sales</Heading>
            <SupplyRows rows={s.outward} empty="No sales this month." />
            <Heading>Less: credit notes</Heading>
            <SupplyRows
              rows={s.creditNotes}
              empty="No credit notes this month."
            />
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-medium">
                Outward supplies, net of credit notes
              </TableCell>
              <TableCell />
              <TableCell numeric className="font-medium">
                <Money value={s.outwardTotal.taxable} />
              </TableCell>
              <TaxCells t={s.outwardTotal} />
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-medium">
                Output GST as booked
              </TableCell>
              <TableCell colSpan={2} />
              <TaxCells t={s.outputTax} />
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-medium">
                4(A)(5) Input tax credit on purchases
              </TableCell>
              <TableCell colSpan={2} />
              <TaxCells t={s.inputTaxCredit} />
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3}>
                Tax to pay in cash, after set-off
              </TableCell>
              <TaxCells t={s.netPayable} />
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="font-normal text-fg-secondary">
                Credit carried forward
              </TableCell>
              <TaxCells t={s.creditCarriedForward} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {s.tdsReceivable > 0n ? (
        <p className="text-xs text-fg-secondary">
          Customers deducted <Money value={s.tdsReceivable} /> TDS this month.
          That&apos;s income tax, not GST, and is shown for reference.
        </p>
      ) : null}
    </div>
  )
}
