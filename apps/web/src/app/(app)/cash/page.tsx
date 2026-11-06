import type { Metadata } from "next"
import Link from "next/link"
import { LandmarkIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Cash · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/cash")
  return (
    <PlaceholderPage
      title="Cash"
      description="Bank and Razorpay balances, and what's reconciled."
      icon={LandmarkIcon}
      emptyTitle="No accounts connected"
      emptyDescription="Upload a bank statement or connect Razorpay to see your cash."
      allowed={allowed}
      role={ctx.role}
      emptyAction={
        <Link href="/cash/upload" className={buttonVariants({ size: "sm" })}>
          Upload bank statement
        </Link>
      }
    />
  )
}
