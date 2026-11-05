import type { Metadata } from "next"
import { PieChartIcon } from "lucide-react"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Reports · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/reports")
  return (
    <PlaceholderPage
      title="Reports"
      description="Profit and loss, balance sheet and more."
      icon={PieChartIcon}
      emptyTitle="No reports yet"
      emptyDescription="Reports fill in as your books do."
      allowed={allowed}
      role={ctx.role}
    />
  )
}
