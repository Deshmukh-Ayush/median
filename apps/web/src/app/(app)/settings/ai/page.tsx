import type { Metadata } from "next"
import type { ReactNode } from "react"
import { LockIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { getAiProviderStatus } from "@/server/ai/models"

import { getOrgContextOrRedirect } from "../../org-context"

export const metadata: Metadata = { title: "AI provider · Median" }

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

/** Owner-only check of which AI provider is active and on what tier. */
export default async function Page() {
  const ctx = await getOrgContextOrRedirect()
  if (ctx.role !== "owner") {
    return (
      <div className="flex max-w-2xl flex-col gap-6 p-6">
        <PageHeader title="AI provider" />
        <div className="rounded-lg border border-default bg-surface">
          <EmptyState
            icon={<LockIcon />}
            title="Owners only"
            description="Ask an owner if you need to check the AI setup."
          />
        </div>
      </div>
    )
  }

  const s = getAiProviderStatus()
  return (
    <div className="flex max-w-2xl flex-col gap-6 p-6">
      <PageHeader
        title="AI provider"
        description="The AI only reads bills and statements and suggests entries. It never posts, and never does the maths."
      />
      {s.freeTierInProduction ? (
        <p
          role="alert"
          className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger"
        >
          This is production and the AI is on the free tier. Free tiers may use
          what they&apos;re sent to improve their models, so real customer data
          must not go there. Enable billing on the Gemini key (or switch
          provider) and set AI_PROVIDER_TIER=paid.
        </p>
      ) : null}
      <dl className="divide-y divide-subtle rounded-lg border border-default bg-surface">
        <Fact label="Provider">{s.provider}</Fact>
        <Fact label="Models">
          <span className="font-mono text-xs">
            {s.fastModel} · {s.smartModel}
          </span>
        </Fact>
        <Fact label="Tier">
          {s.tier === "paid" ? (
            <StatusChip tone="success">Paid</StatusChip>
          ) : (
            <StatusChip tone={s.production ? "danger" : "warning"}>
              Free: test data only
            </StatusChip>
          )}
          {!s.tierDeclared ? (
            <span className="block text-xs text-fg-secondary">
              AI_PROVIDER_TIER isn&apos;t set, so this counts as free.
            </span>
          ) : null}
        </Fact>
        <Fact label="API key">
          {s.keyConfigured ? (
            <StatusChip tone="success">Set</StatusChip>
          ) : (
            <StatusChip tone="danger">Missing</StatusChip>
          )}
        </Fact>
        <Fact label="Environment">
          {s.production ? "Production" : "Not production"}
        </Fact>
      </dl>
    </div>
  )
}
