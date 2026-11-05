"use client"

import { useRouter } from "next/navigation"

import { CommandBar } from "@workspace/ui/components/command-bar"
import type { CommandBarGroup } from "@workspace/ui/components/command-bar"

/** Ctrl/⌘+K, navigating with the App Router instead of full page loads. */
export function AppCommandBar({
  groups,
}: {
  groups: readonly CommandBarGroup[]
}) {
  const router = useRouter()
  return <CommandBar groups={groups} onNavigate={(href) => router.push(href)} />
}
