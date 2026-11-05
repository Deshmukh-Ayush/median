import type { Metadata } from "next"
import Link from "next/link"

import { SignUpForm } from "@/components/auth/sign-up-form"
import type { SearchParams } from "@/lib/page-props"
import { safeRedirect } from "@/lib/safe-redirect"

export const metadata: Metadata = { title: "Create an account · Median" }

export default async function SignUpPage(props: {
  searchParams: SearchParams
}) {
  const { redirectTo } = await props.searchParams
  const next = safeRedirect(redirectTo, "/onboarding")
  const signInHref =
    next === "/onboarding"
      ? "/sign-in"
      : `/sign-in?redirectTo=${encodeURIComponent(next)}`
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg font-semibold">
          Create your account
        </h1>
        <p className="text-sm text-fg-secondary">
          Books, GST and money in one place. Takes a minute.
        </p>
      </div>
      <SignUpForm redirectTo={next} />
      <p className="text-sm text-fg-secondary">
        Already have an account?{" "}
        <Link
          href={signInHref}
          className="font-medium text-fg underline underline-offset-2"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
