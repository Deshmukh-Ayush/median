import type { Metadata } from "next"
import Link from "next/link"
import { FileTextIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"

import { PlaceholderPage } from "@/components/shell/placeholder-page"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Invoices · Median" }

export default async function Page() {
  const { ctx, allowed } = await getPageContext("/invoices")
  return (
    <PlaceholderPage
      title="Invoices"
      description="Invoices you've sent and money owed to you."
      icon={FileTextIcon}
      emptyTitle="No invoices yet"
      emptyDescription="Invoices you create or import show up here, with who owes what."
      allowed={allowed}
      role={ctx.role}
      emptyAction={
        <Link href="/invoices/new" className={buttonVariants({ size: "sm" })}>
          New invoice
        </Link>
      }
    />
  )
}
