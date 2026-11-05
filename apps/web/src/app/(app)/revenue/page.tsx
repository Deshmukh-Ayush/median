import type { Metadata } from "next"
import { TrendingUpIcon } from "lucide-react"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Revenue · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/revenue")
  return (
    <PlaceholderPage
      title="Revenue"
      description="Money in, by stream and customer."
      icon={TrendingUpIcon}
      emptyTitle="No revenue yet"
      emptyDescription="Connect Razorpay or send an invoice and your revenue shows up here."
      allowed={allowed}
      role={ctx.role}
    />
  )
}
