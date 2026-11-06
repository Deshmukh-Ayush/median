import type { Metadata } from "next"
import { LandmarkIcon, LockIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { EmptyState } from "@workspace/ui/components/empty-state"

import { AddBankAccountForm } from "@/components/cash/add-bank-account-form"
import { BankStatementUpload } from "@/components/cash/bank-statement-upload"
import { can } from "@/lib/permissions"
import { listConnections, listLedgerAccounts } from "@/server/services"

import { getPageContext } from "../../org-context"

export const metadata: Metadata = { title: "Upload bank statement · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/cash")
  const canImport =
    allowed && can(ctx.role, { resource: "ledger", action: "post" })

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Upload bank statement"
        description="We match each line to settlements, invoices and known vendors. Anything we can't match goes to the AI inbox."
      />
      {canImport ? (
        <Accounts ctx={ctx} />
      ) : (
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<LockIcon />}
            title="You can't import statements"
            description="Importing posts entries to the books. Ask an owner or finance member to upload it."
          />
        </div>
      )}
    </div>
  )
}

async function Accounts({
  ctx,
}: {
  ctx: Awaited<ReturnType<typeof getPageContext>>["ctx"]
}) {
  const accounts = (await listConnections(ctx))
    .filter((c) => c.provider === "bank-statement" && c.status !== "revoked")
    .map((c) => ({ id: c.id, label: c.label }))

  if (accounts.length > 0) return <BankStatementUpload accounts={accounts} />

  // No bank connection yet: add one here (owners and finance).
  if (can(ctx.role, { resource: "settings", action: "update" })) {
    const { items } = await listLedgerAccounts(ctx, null, { bankOnly: true })
    if (items.length > 0) {
      return (
        <AddBankAccountForm
          ledgerAccounts={items.map((a) => ({
            id: a.id,
            label: `${a.code} · ${a.name}`,
          }))}
        />
      )
    }
  }
  return (
    <div className="rounded-lg border border-default bg-surface">
      <EmptyState
        icon={<LandmarkIcon />}
        title="No bank account yet"
        description="Ask an owner or finance member to add the bank account first."
      />
    </div>
  )
}
