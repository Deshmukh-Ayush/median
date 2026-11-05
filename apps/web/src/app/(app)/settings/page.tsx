import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon, UsersIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"

export const metadata: Metadata = { title: "Settings · Median" }

export default function SettingsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Settings" />
      <nav
        aria-label="Settings"
        className="overflow-hidden rounded-lg border border-default bg-surface"
      >
        <Link
          href="/settings/members"
          className="flex h-12 items-center gap-3 px-4 text-sm transition-colors hover:bg-hover"
        >
          <UsersIcon aria-hidden className="size-4 text-fg-secondary" />
          <span className="flex-1">Members</span>
          <ChevronRightIcon aria-hidden className="size-4 text-fg-secondary" />
        </Link>
      </nav>
    </div>
  )
}
