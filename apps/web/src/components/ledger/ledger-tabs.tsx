import { ViewTabs } from "@/components/reports/view-tabs"
import { can } from "@/lib/permissions"
import { journalHref, trialBalanceHref } from "@/lib/report-params"
import type { OrgRole } from "@/server/auth/permissions"

export type LedgerView = "journal" | "trial-balance" | "review"

/** Journal, trial balance (report readers) and CA review. */
export function LedgerTabs({
  role,
  active,
}: {
  role: OrgRole
  active: LedgerView
}) {
  const reports = can(role, { resource: "report", action: "read" })
  return (
    <ViewTabs
      label="Ledger views"
      tabs={[
        { label: "Journal", href: journalHref(), active: active === "journal" },
        ...(reports
          ? [
              {
                label: "Trial balance",
                href: trialBalanceHref(),
                active: active === "trial-balance",
              },
            ]
          : []),
        {
          label: "CA review",
          href: "/ledger/review",
          active: active === "review",
        },
      ]}
    />
  )
}
