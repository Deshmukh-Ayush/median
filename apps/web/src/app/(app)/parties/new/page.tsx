import type { Metadata } from "next"
import Link from "next/link"
import { UsersIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"

import { PartyForm } from "@/components/parties/party-form"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { PARTY_STATES } from "@/lib/party-states"
import { firstParam } from "@/lib/report-params"
import { safeRedirect } from "@/lib/safe-redirect"

import { getPageContext } from "../../org-context"

export const metadata: Metadata = { title: "New customer or vendor · Median" }

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/parties"),
    searchParams,
  ])
  const kind = firstParam(params.kind) === "vendor" ? "vendor" : "customer"
  const next = firstParam(params.next)
  if (!allowed || !can(ctx.role, { resource: "ledger", action: "propose" }))
    return (
      <PlaceholderPage
        title={`New ${kind}`}
        description=""
        icon={UsersIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={`New ${kind}`}
        description={
          <>
            Add their GSTIN and we fill in the state and PAN.{" "}
            <Link href="/parties" className="underline">
              Back to the list
            </Link>
          </>
        }
      />
      <PartyForm
        kind={kind}
        states={PARTY_STATES}
        today={todayIso()}
        {...(next ? { next: safeRedirect(next, "/parties") } : {})}
      />
    </div>
  )
}
