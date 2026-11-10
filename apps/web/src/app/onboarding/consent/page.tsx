import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Logo } from "@workspace/ui/components/logo"

import { getOrgContextOrRedirect } from "@/app/(app)/org-context"
import { acceptConsent } from "@/app/(app)/settings/integrations/actions"
import { DataHandlingPoints } from "@/components/consent/data-handling-points"
import { can } from "@/lib/permissions"
import { getConsentStatus } from "@/server/services"

import { ONBOARDING_STEPS } from "../steps"

export const metadata: Metadata = { title: "Your data · Median" }

const NEXT = "/onboarding/connect"

/** Onboarding step 3: consent, before any data comes in. */
export default async function OnboardingConsentPage() {
  const ctx = await getOrgContextOrRedirect()
  if (!can(ctx.role, { resource: "settings", action: "update" })) redirect("/")
  const status = await getConsentStatus(ctx)
  if (status.accepted) redirect(NEXT)

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 bg-app px-4 py-12">
      <Logo />
      <section
        aria-labelledby="consent"
        className="flex w-full max-w-xl flex-col gap-5 rounded-lg border border-default bg-surface p-6"
      >
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-fg-secondary">
            Step 3 of {ONBOARDING_STEPS}
          </p>
          <h1 id="consent" className="font-display text-lg font-semibold">
            How Median handles your data
          </h1>
          <p className="text-sm text-fg-secondary">
            Read this before you bring in payments, bank lines or your Tally
            books.
          </p>
        </div>
        <DataHandlingPoints />
        <p className="text-xs text-fg-secondary">
          Version {status.currentVersion}
        </p>
        <form
          action={acceptConsent.bind(null, NEXT)}
          className="flex flex-col gap-2"
        >
          <Button type="submit" variant="primary">
            I agree, continue
          </Button>
          <Link
            href="/"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Not now, go to the dashboard
          </Link>
        </form>
      </section>
    </main>
  )
}
