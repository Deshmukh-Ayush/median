import type { Metadata } from "next"
import { InboxIcon } from "lucide-react"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "AI inbox · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/inbox")
  return (
    <PlaceholderPage
      title="AI inbox"
      description="Everything waiting for you, ranked by impact."
      icon={InboxIcon}
      emptyTitle="Nothing to review yet"
      emptyDescription="When the AI reads a bill or matches a bank line, it lands here for your approval."
      allowed={allowed}
      role={ctx.role}
    />
  )
}
