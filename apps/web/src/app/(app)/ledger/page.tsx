import type { Metadata } from "next"
import { BookOpenIcon } from "lucide-react"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Ledger · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/ledger")
  return (
    <PlaceholderPage
      title="Ledger"
      description="Every entry in your books, for you and your CA."
      icon={BookOpenIcon}
      emptyTitle="No entries yet"
      emptyDescription="Approved items and imports become entries here."
      allowed={allowed}
      role={ctx.role}
    />
  )
}
