import Link from "next/link"

import { idSchema } from "@workspace/contracts"
import type { Money as MoneyValue } from "@workspace/contracts"
import { Money } from "@workspace/ui/components/money"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import type { ReportSection } from "@/server/services"

/**
 * One side of a financial statement: sections, their account rows and
 * subtotals, and a grand total. Every number comes from the service; each
 * account row links to the entries behind it.
 */
export function StatementTable({
  title,
  sections,
  total,
  totalLabel,
  rowHref,
}: {
  title: string
  sections: readonly ReportSection[]
  total: MoneyValue
  totalLabel: string
  /** Drill-down for a row; null for rows that aren't accounts. */
  rowHref: (accountId: string) => string | null
}) {
  return (
    <div className="rounded-lg border border-default bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{title}</TableHead>
            <TableHead numeric className="w-44">
              Amount
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => (
            <SectionRows
              key={section.key}
              section={section}
              rowHref={rowHref}
            />
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="font-semibold">{totalLabel}</TableCell>
            <TableCell numeric className="font-semibold">
              <Money value={total} variant="ledger" />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}

function SectionRows({
  section,
  rowHref,
}: {
  section: ReportSection
  rowHref: (accountId: string) => string | null
}) {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={2} className="h-9 pt-3 font-medium">
          {section.label}
        </TableCell>
      </TableRow>
      {section.rows.length === 0 ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={2} className="pl-8 text-fg-tertiary">
            Nothing yet
          </TableCell>
        </TableRow>
      ) : (
        section.rows.map((row) => {
          const href = rowHref(row.accountId)
          const amount = <Money value={row.amount} variant="ledger" />
          return (
            <TableRow key={row.accountId}>
              <TableCell className="pl-8">
                {row.code ? (
                  <span className="text-fg-secondary tabular">{row.code} </span>
                ) : null}
                {href ? (
                  <Link href={href} className="hover:underline">
                    {row.name}
                  </Link>
                ) : (
                  row.name
                )}
              </TableCell>
              <TableCell numeric>
                {href ? (
                  <Link href={href} className="hover:underline">
                    {amount}
                  </Link>
                ) : (
                  amount
                )}
              </TableCell>
            </TableRow>
          )
        })
      )}
      <TableRow className="hover:bg-transparent">
        <TableCell className="pl-8 text-fg-secondary">
          Total {section.label.toLowerCase()}
        </TableCell>
        <TableCell numeric className="font-medium">
          <Money value={section.total} variant="ledger" />
        </TableCell>
      </TableRow>
    </>
  )
}

/** Only real account ids drill down; synthetic rows (current-year profit) don't. */
export const isAccountId = (id: string) => idSchema.safeParse(id).success
