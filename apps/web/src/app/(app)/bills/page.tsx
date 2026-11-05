import type { Metadata } from "next"
import { ReceiptIcon } from "lucide-react"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Bills · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/bills")
  return (
    <PlaceholderPage
      title="Bills"
      description="Bills from vendors, read by the AI."
      icon={ReceiptIcon}
      emptyTitle="No bills yet"
      emptyDescription="Upload a bill and the AI reads the vendor, GST and amounts for you."
      allowed={allowed}
      role={ctx.role}
    />
  )
}
