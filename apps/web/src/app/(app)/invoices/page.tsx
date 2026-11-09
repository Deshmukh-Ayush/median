import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { FileTextIcon, PlusIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatCard } from "@workspace/ui/components/stat-card"

import { InvoiceList } from "@/components/invoices/invoice-list"
import { ReceivablesAgeing } from "@/components/invoices/receivables-ageing"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { todayIso } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { firstParam, idParam } from "@/lib/report-params"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Invoices · Median" }

const TITLE = "Invoices"
const DESCRIPTION = "Invoices you've sent and money owed to you."

function AgeingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <StatCard key={i} label="" loading />
        ))}
      </div>
      <Skeleton className="h-32 rounded-lg" />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  )
}

interface State {
  readonly cursor: string | null
  readonly ageing: string | null
  readonly customer: string | null
}

/** This page's URL with some of its state changed. */
function href(state: State, patch: Partial<State>): string {
  const next = { ...state, ...patch }
  const params = new URLSearchParams()
  if (next.customer) params.set("customer", next.customer)
  if (next.ageing) params.set("ageing", next.ageing)
  if (next.cursor) params.set("cursor", next.cursor)
  const query = params.toString()
  return query ? `/invoices?${query}` : "/invoices"
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/invoices"),
    searchParams,
  ])
  if (!allowed) {
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={FileTextIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  }

  const state: State = {
    cursor: firstParam(params.cursor) ?? null,
    ageing: firstParam(params.ageing) ?? null,
    customer: idParam(params.customer) ?? null,
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          can(ctx.role, { resource: "ledger", action: "post" }) ? (
            <Link
              href="/invoices/new"
              className={buttonVariants({ variant: "primary", size: "sm" })}
            >
              <PlusIcon aria-hidden />
              New invoice
            </Link>
          ) : null
        }
      />
      <Suspense key={`ageing:${state.ageing}`} fallback={<AgeingSkeleton />}>
        <ReceivablesAgeing
          ctx={ctx}
          cursor={state.ageing}
          hrefFor={(p) =>
            href(state, {
              ...(p.ageing !== undefined ? { ageing: p.ageing } : {}),
              ...(p.customer !== undefined
                ? { customer: p.customer, cursor: null }
                : {}),
            })
          }
        />
      </Suspense>
      <Suspense
        key={`list:${state.customer}:${state.cursor}`}
        fallback={<ListSkeleton />}
      >
        <InvoiceList
          ctx={ctx}
          cursor={state.cursor}
          customerId={state.customer ?? undefined}
          today={todayIso()}
          hrefFor={(p) =>
            href(state, {
              ...(p.cursor !== undefined ? { cursor: p.cursor } : {}),
              ...(p.customer !== undefined ? { customer: p.customer } : {}),
            })
          }
        />
      </Suspense>
    </div>
  )
}
