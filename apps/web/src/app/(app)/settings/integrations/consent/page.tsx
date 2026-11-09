import type { Metadata } from "next"
import Link from "next/link"
import { ShieldCheckIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { Button } from "@workspace/ui/components/button"

import { formatDateTime } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { safeRedirect } from "@/lib/safe-redirect"
import { getConsentStatus } from "@/server/services"

import { getOrgContextOrRedirect } from "../../../org-context"
import { acceptConsent } from "../actions"

export const metadata: Metadata = { title: "Your data · Median" }

const POINTS: readonly { title: string; body: string }[] = [
  {
    title: "What we store",
    body: "Payments, refunds, settlements and bank lines from the sources you connect, the bills and statements you upload, and the entries made from them. Access tokens are encrypted, and connections are read-only.",
  },
  {
    title: "Where it's stored",
    body: "In our database in the Singapore region (AWS ap-southeast-1), encrypted at rest and in transit.",
  },
  {
    title: "Who can see it",
    body: "Members of this organisation, according to the role you give them. You can remove a member at any time.",
  },
  {
    title: "Export or delete",
    body: "You can export everything, or ask us to delete your organisation's data. Ledger, invoices and the audit log are kept read-only for 8 years after the financial year ends, as tax law requires, then purged.",
  },
]

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const ctx = await getOrgContextOrRedirect()
  const rawNext = (await searchParams).next
  const next = safeRedirect(
    typeof rawNext === "string" ? rawNext : undefined,
    "/settings/integrations"
  )
  const status = await getConsentStatus(ctx)
  const canAccept = can(ctx.role, { resource: "settings", action: "update" })

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-6">
      <PageHeader
        title="How Median handles your data"
        description="Read this before connecting Razorpay, a bank or anything else that brings your data in."
      />
      <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-default bg-surface">
        {POINTS.map((point) => (
          <li key={point.title} className="flex flex-col gap-1 px-4 py-3">
            <h2 className="text-sm font-semibold">{point.title}</h2>
            <p className="text-sm text-fg-secondary">{point.body}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-secondary">
        Version {status.currentVersion}
      </p>

      {status.accepted ? (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheckIcon aria-hidden className="size-4 text-success" />
            Accepted
            {status.acceptedBy ? ` by ${status.acceptedBy.name}` : ""}
            {status.acceptedAt
              ? ` on ${formatDateTime(status.acceptedAt)}`
              : ""}
            .
          </p>
          <Link
            href={next}
            className="text-sm font-medium underline underline-offset-2"
          >
            Continue
          </Link>
        </div>
      ) : canAccept ? (
        <form action={acceptConsent.bind(null, next)} className="flex gap-2">
          <Button type="submit" variant="primary">
            I agree, continue
          </Button>
          <Link
            href="/settings"
            className="inline-flex h-8 items-center px-3 text-sm text-fg-secondary"
          >
            Not now
          </Link>
        </form>
      ) : (
        <p className="text-sm text-fg-secondary">
          Ask an owner or your finance lead to accept this for your
          organisation.
        </p>
      )}
    </div>
  )
}
