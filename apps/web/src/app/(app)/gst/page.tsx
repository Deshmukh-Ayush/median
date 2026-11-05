import type { Metadata } from "next"
import { PercentIcon } from "lucide-react"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "GST · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/gst")
  return (
    <PlaceholderPage
      title="GST"
      description="Tax due each month, returns and deadlines."
      icon={PercentIcon}
      emptyTitle="No GST data yet"
      emptyDescription="Once invoices and bills are in, your monthly GST summary shows up here."
      allowed={allowed}
      role={ctx.role}
    />
  )
}
