import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { ArrowRightIcon, Building2Icon } from "lucide-react"

import { INDUSTRIES } from "@workspace/ledger"
import type { Industry } from "@workspace/ledger"
import { Button } from "@workspace/ui/components/button"
import { Logo } from "@workspace/ui/components/logo"

import { signOut } from "@/app/(auth)/actions"
import { CreateOrganizationForm } from "@/components/auth/create-organization-form"
import type { BusinessTypeOption } from "@/components/auth/create-organization-form"
import { getAuth } from "@/server/auth"

import { openOrganization } from "./actions"
import { ONBOARDING_STEPS } from "./steps"

export const metadata: Metadata = { title: "Set up your organisation · Median" }

// Keyed by the ledger's chart-of-accounts templates, so a new template
// fails the build until it has a label here.
const BUSINESS_TYPE_COPY: Record<
  Industry,
  Omit<BusinessTypeOption, "value">
> = {
  saas: {
    label: "SaaS",
    description:
      "Subscriptions and software services, usually billed monthly or yearly.",
  },
  d2c: {
    label: "D2C",
    description:
      "You sell physical products to customers online, with stock to track.",
  },
  agency: {
    label: "Agency",
    description:
      "Services and retainers for clients, billed by project or month.",
  },
}

const BUSINESS_TYPES: readonly BusinessTypeOption[] = INDUSTRIES.map(
  (value) => ({ value, ...BUSINESS_TYPE_COPY[value] })
)

export default async function OnboardingPage() {
  const requestHeaders = await headers()
  const auth = getAuth()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) redirect("/sign-in?redirectTo=/onboarding")
  const organizations = await auth.api.listOrganizations({
    headers: requestHeaders,
  })

  return (
    <main className="flex min-h-svh flex-col items-center gap-6 bg-app px-4 py-12">
      <Logo />
      <div className="flex w-full max-w-md flex-col gap-4">
        {organizations.length > 0 ? (
          <section
            aria-labelledby="existing-orgs"
            className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-4"
          >
            <h2 id="existing-orgs" className="text-sm font-semibold">
              Your organisations
            </h2>
            <ul className="flex flex-col gap-1">
              {organizations.map((org) => (
                <li key={org.id}>
                  <form action={openOrganization.bind(null, org.id)}>
                    <Button
                      type="submit"
                      variant="ghost"
                      className="w-full justify-start"
                    >
                      <Building2Icon aria-hidden />
                      <span className="flex-1 truncate text-left">
                        {org.name}
                      </span>
                      <ArrowRightIcon
                        aria-hidden
                        className="text-fg-secondary"
                      />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="create-org"
          className="flex flex-col gap-5 rounded-lg border border-default bg-surface p-6"
        >
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-fg-secondary">
              Step 1 of {ONBOARDING_STEPS}
            </p>
            <h1 id="create-org" className="font-display text-lg font-semibold">
              {organizations.length > 0
                ? "Or set up another organisation"
                : "Set up your organisation"}
            </h1>
            <p className="text-sm text-fg-secondary">
              We set up your chart of accounts for your kind of business. You
              can change it later.
            </p>
          </div>
          <CreateOrganizationForm businessTypes={BUSINESS_TYPES} />
        </section>

        <form action={signOut} className="self-center">
          <Button type="submit" variant="ghost" size="sm">
            Sign out ({session.user.email})
          </Button>
        </form>
      </div>
    </main>
  )
}
