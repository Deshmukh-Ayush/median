import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { UsersIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { ArchivePartyButton } from "@/components/parties/archive-party-button"
import { PartyForm } from "@/components/parties/party-form"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { todayIso } from "@/lib/format-date"
import { can } from "@/lib/permissions"
import { PARTY_STATES } from "@/lib/party-states"
import { getParty } from "@/server/services"

import { getPageContext } from "../../org-context"

export const metadata: Metadata = { title: "Customer or vendor · Median" }

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ ctx, allowed }, { id }] = await Promise.all([
    getPageContext("/parties"),
    params,
  ])
  if (!allowed)
    return (
      <PlaceholderPage
        title="Customer or vendor"
        description=""
        icon={UsersIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  let party
  try {
    party = await getParty(ctx, id)
  } catch (error) {
    if (
      isServiceError(error) &&
      ["NOT_FOUND", "VALIDATION"].includes(error.code)
    )
      notFound()
    throw error
  }
  const canEdit = can(ctx.role, { resource: "ledger", action: "propose" })
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={party.name}
        description={
          <>
            {party.kind === "customer" ? "Customer" : "Vendor"}
            {party.archivedAt ? (
              <StatusChip className="ml-2">Archived</StatusChip>
            ) : null}
            {" · "}
            <Link
              href={
                party.kind === "customer"
                  ? `/invoices?customer=${party.id}`
                  : "/parties?kind=vendor"
              }
              className="underline"
            >
              {party.kind === "customer" ? "Their invoices" : "All vendors"}
            </Link>
          </>
        }
        actions={
          canEdit ? (
            <ArchivePartyButton
              id={party.id}
              archived={party.archivedAt !== null}
            />
          ) : null
        }
      />
      {canEdit ? (
        <PartyForm
          kind={party.kind}
          party={party}
          states={PARTY_STATES}
          today={todayIso()}
        />
      ) : (
        <p className="text-sm text-fg-secondary">
          Your role can see this {party.kind} but not change it.
        </p>
      )}
    </div>
  )
}
