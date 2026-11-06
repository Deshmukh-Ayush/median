import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { InboxIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { InboxView } from "@/components/inbox/inbox-view"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import {
  listInboxItems,
  listLedgerAccounts,
  listParties,
  MAX_PAGE_SIZE,
} from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../org-context"
import { approveItems, rejectItem } from "./actions"
import { toInboxRow } from "./rows"

export const metadata: Metadata = { title: "AI inbox · Median" }

const TITLE = "AI inbox"
const DESCRIPTION = "Everything waiting for you, ranked by impact."

function InboxSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-lg" />
    </div>
  )
}

async function Inbox({
  ctx,
  cursor,
}: {
  ctx: OrgContext
  cursor: string | null
}) {
  let data
  try {
    // One call each; names are joined in memory, not per line.
    const [page, accounts, parties] = await Promise.all([
      listInboxItems(ctx, cursor),
      listLedgerAccounts(ctx, null, {}, { limit: MAX_PAGE_SIZE }),
      listParties(ctx, null, {}, { limit: MAX_PAGE_SIZE }),
    ])
    data = { page, accounts, parties }
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<InboxIcon />}
          title="We couldn't load the inbox"
          description={error.message}
        />
      </div>
    )
  }

  const accountNames = new Map(data.accounts.items.map((a) => [a.id, a.name]))
  const partyNames = new Map(data.parties.items.map((p) => [p.id, p.name]))
  const rows = data.page.items.map((item) =>
    toInboxRow(item, accountNames, partyNames)
  )

  return (
    <div className="flex flex-col gap-4">
      <InboxView
        // Remount when the page changes so selection starts fresh.
        key={cursor ?? "first"}
        rows={rows}
        canApprove={can(ctx.role, { resource: "ledger", action: "post" })}
        canReject={can(ctx.role, { resource: "ledger", action: "propose" })}
        approveItems={approveItems}
        rejectItem={rejectItem}
      />
      {cursor || data.page.nextCursor ? (
        <nav aria-label="Pages" className="flex justify-end gap-2">
          {cursor ? (
            <Link href="/inbox" className={buttonVariants({ size: "sm" })}>
              First page
            </Link>
          ) : null}
          {data.page.nextCursor ? (
            <Link
              href={`/inbox?cursor=${encodeURIComponent(data.page.nextCursor)}`}
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

export default async function InboxPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { ctx, allowed } = await getPageContext("/inbox")
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={InboxIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }
  const raw = (await searchParams).cursor
  const cursor = typeof raw === "string" && raw.length > 0 ? raw : null
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <Suspense key={cursor ?? "first"} fallback={<InboxSkeleton />}>
        <Inbox ctx={ctx} cursor={cursor} />
      </Suspense>
    </div>
  )
}
