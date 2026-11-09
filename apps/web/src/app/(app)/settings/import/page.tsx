import type { Metadata } from "next"
import { LockIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { EmptyState } from "@workspace/ui/components/empty-state"

import { TallyImport } from "@/components/settings/tally-import"
import { can } from "@/lib/permissions"

import { getOrgContextOrRedirect } from "../../org-context"
import { importTallyFile } from "./actions"

export const metadata: Metadata = { title: "Move from Tally · Median" }

export default async function Page() {
  const ctx = await getOrgContextOrRedirect()
  const canImport = can(ctx.role, { resource: "ledger", action: "post" })

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader
        title="Move from Tally"
        description="Bring your Tally books into Median: ledgers, opening balances and vouchers, then check the trial balance matches."
      />
      {canImport ? (
        <TallyImport importTallyFile={importTallyFile} />
      ) : (
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<LockIcon />}
            title="You can't import books"
            description="Importing posts entries. Ask an owner or finance member."
          />
        </div>
      )}
      <p className="text-xs text-fg-secondary">
        Moving from Zoho Books isn&apos;t supported yet.
      </p>
    </div>
  )
}
