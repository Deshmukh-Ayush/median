import Link from "next/link"
import { ScaleIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { AccountType, IsoDate } from "@workspace/contracts"
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

import { formatDate } from "@/lib/format-date"
import { journalHref } from "@/lib/report-params"
import { getTrialBalance } from "@/server/services"
import type { OrgContext } from "@/server/services"

const TYPE_LABELS: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
}

/** Closing debit and credit balance of every account, for the CA. */
export async function TrialBalanceView({
  ctx,
  asOf,
}: {
  ctx: OrgContext
  asOf: IsoDate
}) {
  let tb
  try {
    tb = await getTrialBalance(ctx, asOf)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<ScaleIcon />}
          title="We couldn't load the trial balance"
          description={error.message}
        />
      </div>
    )
  }

  if (tb.rows.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<ScaleIcon />}
          title="No balances yet"
          description={`No account has activity up to ${formatDate(tb.asOf)}.`}
        />
      </div>
    )
  }

  // Equality check only; the totals themselves come from the service.
  const balanced = tb.totalDebit === tb.totalCredit

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-fg-secondary">
        <span>As of {formatDate(tb.asOf)}</span>
        {balanced ? (
          <StatusChip tone="success" dot>
            Balanced
          </StatusChip>
        ) : (
          <StatusChip tone="danger" dot>
            Debits and credits don&apos;t match
          </StatusChip>
        )}
      </div>
      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead numeric className="w-40">
                Debit
              </TableHead>
              <TableHead numeric className="w-40">
                Credit
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tb.rows.map((row) => {
              const href = journalHref({
                accountId: row.accountId,
                to: tb.asOf,
              })
              return (
                <TableRow key={row.accountId}>
                  <TableCell className="text-fg-secondary tabular">
                    {row.code}
                  </TableCell>
                  <TableCell>
                    <Link href={href} className="hover:underline">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-fg-secondary">
                    {TYPE_LABELS[row.type]}
                  </TableCell>
                  <TableCell numeric>
                    {row.debit > 0n ? (
                      <Link href={href} className="hover:underline">
                        <Money value={row.debit} variant="ledger" />
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell numeric>
                    {row.credit > 0n ? (
                      <Link href={href} className="hover:underline">
                        <Money value={row.credit} variant="ledger" />
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3}>Total</TableCell>
              <TableCell numeric>
                <Money value={tb.totalDebit} variant="ledger" />
              </TableCell>
              <TableCell numeric>
                <Money value={tb.totalCredit} variant="ledger" />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  )
}
