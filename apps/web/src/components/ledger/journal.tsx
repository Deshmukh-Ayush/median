import Link from "next/link"
import { BookOpenIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type {
  JournalEntryView,
  Money as MoneyValue,
} from "@workspace/contracts"
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
import { SOURCE_LABELS, journalHref } from "@/lib/report-params"
import type { JournalLink } from "@/lib/report-params"
import { listEntries } from "@/server/services"
import type { OrgContext } from "@/server/services"

function Amount({ value }: { value: MoneyValue }) {
  return value > 0n ? <Money value={value} variant="ledger" /> : null
}

function EntryRows({ entry }: { entry: JournalEntryView }) {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell className="h-9 border-b-0 pt-2 align-bottom text-fg-secondary tabular">
          {formatDate(entry.entryDate)}
        </TableCell>
        <TableCell
          colSpan={3}
          className="h-9 border-b-0 pt-2 align-bottom whitespace-normal"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{entry.narration}</span>
            <StatusChip>{SOURCE_LABELS[entry.sourceType]}</StatusChip>
            {entry.reversedByEntryId ? (
              <StatusChip tone="warning">Reversed</StatusChip>
            ) : null}
            {entry.reversesEntryId ? (
              <StatusChip tone="info">Reverses an earlier entry</StatusChip>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {entry.lines.map((line, i) => {
        const last = i === entry.lines.length - 1
        const border = last ? undefined : "border-b-0"
        return (
          <TableRow key={line.id}>
            <TableCell className={border} />
            <TableCell className={`${border ?? ""} whitespace-normal`}>
              <Link
                href={journalHref({ accountId: line.account.id })}
                className={
                  line.credit > 0n ? "pl-6 hover:underline" : "hover:underline"
                }
              >
                <span className="text-fg-secondary tabular">
                  {line.account.code}
                </span>{" "}
                {line.account.name}
              </Link>
              {line.party ? (
                <span className="text-fg-secondary"> · {line.party.name}</span>
              ) : null}
              {line.description ? (
                <span className="block text-xs text-fg-secondary">
                  {line.description}
                </span>
              ) : null}
            </TableCell>
            <TableCell numeric className={border}>
              <Amount value={line.debit} />
            </TableCell>
            <TableCell numeric className={border}>
              <Amount value={line.credit} />
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

/**
 * The journal: every posted entry with its lines, newest first. Filters come
 * from the URL so every report number can link straight here.
 */
export async function Journal({
  ctx,
  filters,
}: {
  ctx: OrgContext
  filters: JournalLink
}) {
  let page
  try {
    page = await listEntries(
      ctx,
      {
        from: filters.from,
        to: filters.to,
        accountId: filters.accountId,
        sourceType: filters.source,
        search: filters.q,
      },
      filters.cursor ?? null
    )
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<BookOpenIcon />}
          title="We couldn't load the journal"
          description={error.message}
        />
      </div>
    )
  }

  if (page.items.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<BookOpenIcon />}
          title="No entries"
          description={
            filters.cursor
              ? "There are no more entries."
              : "Nothing matches these filters yet."
          }
          action={
            filters.cursor ? (
              <Link
                href={journalHref({ ...filters, cursor: undefined })}
                className={buttonVariants({ size: "sm" })}
              >
                First page
              </Link>
            ) : undefined
          }
        />
      </div>
    )
  }

  const account = filters.accountId
    ? page.items
        .flatMap((e) => e.lines)
        .find((l) => l.account.id === filters.accountId)?.account
    : undefined

  return (
    <div className="flex flex-col gap-4">
      {account ? (
        <p className="text-sm text-fg-secondary">
          Entries touching{" "}
          <span className="font-medium text-fg">
            {account.code} {account.name}
          </span>
        </p>
      ) : null}
      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-32">Date</TableHead>
              <TableHead>Particulars</TableHead>
              <TableHead numeric className="w-40">
                Debit
              </TableHead>
              <TableHead numeric className="w-40">
                Credit
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((entry) => (
              <EntryRows key={entry.id} entry={entry} />
            ))}
          </TableBody>
        </Table>
      </div>
      {filters.cursor || page.nextCursor ? (
        <nav aria-label="Pages" className="flex justify-end gap-2">
          {filters.cursor ? (
            <Link
              href={journalHref({ ...filters, cursor: undefined })}
              className={buttonVariants({ size: "sm" })}
            >
              First page
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link
              href={journalHref({ ...filters, cursor: page.nextCursor })}
              className={buttonVariants({ size: "sm" })}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
