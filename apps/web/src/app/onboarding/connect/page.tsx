import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import {
  ArrowRightIcon,
  BookOpenIcon,
  CreditCardIcon,
  LandmarkIcon,
} from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import { Logo } from "@workspace/ui/components/logo"

import { getOrgContextOrRedirect } from "@/app/(app)/org-context"
import { importConnectorFile } from "@/app/(app)/settings/integrations/actions"
import { FileImportForm } from "@/components/integrations/connector-forms"
import { can } from "@/lib/permissions"
import { getConsentStatus } from "@/server/services"

import { ONBOARDING_STEPS } from "../steps"

export const metadata: Metadata = { title: "Bring in your data · Median" }

function Option({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 text-fg-secondary [&_svg]:size-4">
          {icon}
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-sm text-fg-secondary">{description}</p>
        </div>
      </div>
      {children}
    </li>
  )
}

/**
 * Onboarding step 4: bring data in. Razorpay is a settlement-report upload
 * until partner OAuth is approved; bank statements and Tally open their
 * full screens, which show what was matched and posted.
 */
export default async function OnboardingConnectPage() {
  const ctx = await getOrgContextOrRedirect()
  if (!can(ctx.role, { resource: "settings", action: "update" })) redirect("/")
  const consent = await getConsentStatus(ctx)
  if (!consent.accepted) redirect("/onboarding/consent")
  const canImport = can(ctx.role, { resource: "ledger", action: "post" })

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 bg-app px-4 py-12">
      <Logo />
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-fg-secondary">
            Step 4 of {ONBOARDING_STEPS}
          </p>
          <h1 className="font-display text-lg font-semibold">
            Bring in your data
          </h1>
          <p className="text-sm text-fg-secondary">
            Start with one. You can add the others later from Settings.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          <Option
            icon={<CreditCardIcon />}
            title="Razorpay settlement report"
            description="In the Razorpay Dashboard, go to Reports → Settlements and download the CSV. Each settlement is posted with its fees and GST."
          >
            {canImport ? (
              <FileImportForm
                action={importConnectorFile}
                provider="razorpay-settlement-report"
                accept={["text/csv"]}
                buttonLabel="Upload report"
              />
            ) : null}
          </Option>
          <Option
            icon={<LandmarkIcon />}
            title="Bank statement"
            description="Add your bank account, then upload a CSV or PDF statement. We match lines to settlements, invoices and vendors."
          >
            <Link
              href="/cash/upload"
              className={buttonVariants({
                size: "sm",
                className: "self-start",
              })}
            >
              Upload a statement
            </Link>
          </Option>
          <Option
            icon={<BookOpenIcon />}
            title="Move from Tally"
            description="Import ledgers, opening balances and vouchers, then check the trial balance matches."
          >
            <Link
              href="/settings/import"
              className={buttonVariants({
                size: "sm",
                className: "self-start",
              })}
            >
              Import from Tally
            </Link>
          </Option>
        </ul>

        <Link
          href="/"
          className={buttonVariants({
            variant: "primary",
            className: "self-end",
          })}
        >
          Go to the dashboard <ArrowRightIcon aria-hidden />
        </Link>
      </div>
    </main>
  )
}
