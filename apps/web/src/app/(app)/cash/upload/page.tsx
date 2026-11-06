import type { Metadata } from "next"
import Link from "next/link"
import { LandmarkIcon, LockIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"

import { BankStatementUpload } from "@/components/cash/bank-statement-upload"
import { can } from "@/lib/permissions"
import { listConnections } from "@/server/services"

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

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<LandmarkIcon />}
          title="No bank account yet"
          description="Add a bank account before uploading its statements."
          action={
            <Link
              href="/settings/integrations"
              className={buttonVariants({ size: "sm" })}
            >
              Go to Integrations
            </Link>
          }
        />
      </div>
    )
  }
  return <BankStatementUpload accounts={accounts} />
}
