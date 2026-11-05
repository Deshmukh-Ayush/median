import type { Metadata } from "next"
import Link from "next/link"

import { SignInForm } from "@/components/auth/sign-in-form"
import type { SearchParams } from "@/lib/page-props"
import { safeRedirect } from "@/lib/safe-redirect"

export const metadata: Metadata = { title: "Sign in · Median" }

export default async function SignInPage(props: {
  searchParams: SearchParams
}) {
  const { redirectTo } = await props.searchParams
  const next = safeRedirect(redirectTo)
  const signUpHref =
    next === "/"
      ? "/sign-up"
      : `/sign-up?redirectTo=${encodeURIComponent(next)}`
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-fg-secondary">
          Welcome back. Your books are where you left them.
        </p>
      </div>
      <SignInForm redirectTo={next} />
      <p className="text-sm text-fg-secondary">
        New to Median?{" "}
        <Link
          href={signUpHref}
          className="font-medium text-fg underline underline-offset-2"
        >
          Create an account
        </Link>
      </p>
    </div>
  )
}
