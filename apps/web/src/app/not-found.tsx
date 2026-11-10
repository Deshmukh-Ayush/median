import type { Metadata } from "next"
import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import { Logo } from "@workspace/ui/components/logo"

export const metadata: Metadata = { title: "Page not found · Median" }

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-app px-4">
      <Logo />
      <h1 className="font-display text-lg font-semibold">
        This page doesn&apos;t exist
      </h1>
      <Link href="/" className={buttonVariants({ size: "sm" })}>
        Go to Median
      </Link>
    </main>
  )
}
