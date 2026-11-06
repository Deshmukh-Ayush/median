import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { GST_STATES } from "@workspace/contracts"
import { Logo } from "@workspace/ui/components/logo"

import { getOrgContextOrRedirect } from "@/app/(app)/org-context"
import { GstProfileForm } from "@/components/onboarding/gst-profile-form"
import type {
  GstProfileDefaults,
  GstStateOption,
} from "@/components/onboarding/gst-profile-form"
import { can } from "@/lib/permissions"
import { bpsToPercentText } from "@/lib/percent"
import { getGstProfile } from "@/server/services"

export const metadata: Metadata = { title: "GST details · Median" }

// Only codes valid on a new document; retired ones (25, 28) are left out.
const STATE_OPTIONS: readonly GstStateOption[] = GST_STATES.filter(
  (state) => state.active
).map((state) => ({ code: state.code, name: state.name }))

export default async function OnboardingGstPage() {
  const ctx = await getOrgContextOrRedirect()
  // Roles that can't change settings have nothing to do here.
  if (!can(ctx.role, { resource: "settings", action: "update" })) redirect("/")

  const profile = await getGstProfile(ctx)
  const defaults: GstProfileDefaults = {
    legalName: profile.legalName ?? "",
    gstRegistered: profile.gstRegistered ? "yes" : "no",
    gstin: profile.gstin ?? "",
    stateCode: profile.stateCode ?? "",
    compositionScheme: profile.compositionScheme,
    defaultGstRate:
      profile.defaultGstRateBps === null
        ? ""
        : bpsToPercentText(profile.defaultGstRateBps),
  }

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 bg-app px-4 py-12">
      <Logo />
      <section
        aria-labelledby="gst-profile"
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-default bg-surface p-6"
      >
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-fg-secondary">Step 2 of 2</p>
          <h1 id="gst-profile" className="font-display text-lg font-semibold">
            Your GST details
          </h1>
          <p className="text-sm text-fg-secondary">
            We use these to put the right tax on invoices and to check bills.
            You can skip this and add them later.
          </p>
        </div>
        <GstProfileForm states={STATE_OPTIONS} defaults={defaults} />
      </section>
    </main>
  )
}
