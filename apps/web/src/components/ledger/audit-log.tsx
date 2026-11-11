import Link from "next/link"
import { HistoryIcon } from "lucide-react"
import { z } from "zod"

import { isServiceError } from "@workspace/contracts"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { formatDateTime } from "@/lib/format-date"
import { listAuditLog } from "@/server/services"
import type { OrgContext } from "@/server/services"

const ACTION_LABELS: Partial<Record<string, string>> = {
  "journal_entry.post": "Posted an entry",
  "journal_entry.reverse": "Reversed an entry",
  "inbox_item.approve": "Approved an inbox item",
  "inbox_item.reject": "Rejected an inbox item",
  "period.lock": "Locked a month",
  "period.unlock": "Unlocked a month",
  "consent.accept": "Accepted the data consent",
  "invoice.create": "Raised an invoice",
  "invoice.receipt": "Recorded an invoice payment",
  "credit_note.create": "Issued a credit note",
  "account.create": "Added a bank account",
  "ledger_account.create": "Added a ledger account",
  "chart_of_accounts.seed": "Set up the chart of accounts",
  "party.create": "Added a customer or vendor",
  "party.update": "Edited a customer or vendor",
  "party.archive": "Archived a customer or vendor",
  "party.restore": "Restored a customer or vendor",
  "settings.payment_terms": "Changed the default payment terms",
  "gst_profile.update": "Updated the GST details",
  "default_gst_rate.set": "Set the default GST rate",
  "gst_rate_mapping.upsert": "Set a GST rate for a product",
  "connection.disconnect": "Disconnected an integration",
  "connection.settings": "Changed integration settings",
  "document.upload": "Uploaded a document",
  "organization.delete_data": "Deleted the organisation's data",
}

/** Snapshots are untyped JSON; pull out a narration if there is one. */
const snapshotSchema = z.looseObject({ narration: z.string().optional() })

function summary(after: unknown): string | null {
  const parsed = snapshotSchema.safeParse(after)
  return parsed.success ? (parsed.data.narration ?? null) : null
}

/** Every change to the books, newest first, for the CA. */
export async function AuditLog({
  ctx,
  cursor,
  pageHref,
}: {
  ctx: OrgContext
  cursor: string | null
  pageHref: (cursor: string | null) => string
}) {
  let page
  try {
    page = await listAuditLog(ctx, cursor)
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<HistoryIcon />}
          title="We couldn't load the audit log"
          description={error.message}
        />
      </div>
    )
  }

  if (page.items.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<HistoryIcon />}
          title={cursor ? "No older changes" : "No changes yet"}
          description="Every change to the books is recorded here."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-default bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-36">When</TableHead>
              <TableHead className="w-44">Who</TableHead>
              <TableHead>What</TableHead>
              <TableHead className="w-24">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((e) => {
              const note = summary(e.after)
              return (
                <TableRow key={e.id} className="align-top">
                  <TableCell className="text-fg-secondary tabular">
                    {formatDateTime(e.at)}
                  </TableCell>
                  <TableCell>
                    {e.actor ? (
                      e.actor.name
                    ) : (
                      <span className="text-fg-secondary">
                        Automatic ({e.source})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {ACTION_LABELS[e.action] ?? e.action}
                    {note ? (
                      <span className="block text-xs text-fg-secondary">
                        {note}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <details>
                      <summary className="cursor-pointer text-xs text-fg-secondary">
                        Show
                      </summary>
                      <pre className="mt-1 max-w-md overflow-auto text-xs whitespace-pre-wrap">
                        {JSON.stringify(
                          {
                            entity: e.entity,
                            id: e.entityId,
                            before: e.before,
                            after: e.after,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {cursor || page.nextCursor ? (
        <nav aria-label="Audit log pages" className="flex justify-end gap-2">
          {cursor ? (
            <Link
              href={pageHref(null)}
              className={buttonVariants({ size: "sm" })}
            >
              Newest
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link
              href={pageHref(page.nextCursor)}
              className={buttonVariants({ size: "sm" })}
            >
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
