import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { PlusIcon, UsersIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { PartyKind } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatusChip } from "@workspace/ui/components/status-chip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { PlaceholderPage } from "@/components/shell/placeholder-page"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import { firstParam } from "@/lib/report-params"
import { listParties } from "@/server/services"
import type { OrgContext } from "@/server/services"

import { getPageContext } from "../org-context"

export const metadata: Metadata = { title: "Customers and vendors · Median" }

const TITLE = "Customers and vendors"
const DESCRIPTION = "Who you bill and who bills you, with their GST details."

const REGISTRATION_LABEL = {
  regular: "Regular",
  composition: "Composition",
  unregistered: "Unregistered",
  sez: "SEZ",
  overseas: "Overseas",
} as const

interface State {
  readonly kind: PartyKind
  readonly q: string | null
  readonly archived: boolean
  readonly cursor: string | null
}

function href(state: State, patch: Partial<State>): string {
  const next = { ...state, ...patch }
  const params = new URLSearchParams()
  if (next.kind === "vendor") params.set("kind", "vendor")
  if (next.q) params.set("q", next.q)
  if (next.archived) params.set("archived", "1")
  if (next.cursor) params.set("cursor", next.cursor)
  const query = params.toString()
  return query ? `/parties?${query}` : "/parties"
}

async function PartyList({ ctx, state }: { ctx: OrgContext; state: State }) {
  let page
  try {
    page = await listParties(ctx, state.cursor, {
      kind: state.kind,
      ...(state.q ? { search: state.q } : {}),
      includeArchived: state.archived,
    })
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <EmptyState
        icon={<UsersIcon />}
        title="We couldn't load this list"
        description={error.message}
      />
    )
  }
  if (page.items.length === 0)
    return (
      <EmptyState
        icon={<UsersIcon />}
        title={state.q ? "No matches" : `No ${state.kind}s yet`}
        description={
          state.kind === "customer"
            ? "Add a customer to raise your first invoice."
            : "Vendors are added when you book a bill, or here."
        }
        action={
          <Link
            href={`/parties/new?kind=${state.kind}`}
            className={buttonVariants({ size: "sm" })}
          >
            Add a {state.kind}
          </Link>
        }
      />
    )
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>GSTIN</TableHead>
            <TableHead>Registration</TableHead>
            <TableHead>State</TableHead>
            <TableHead numeric>Terms</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <Link
                  href={`/parties/${p.id}`}
                  className="font-medium hover:underline"
                >
                  {p.name}
                </Link>
                {p.archivedAt ? (
                  <StatusChip className="ml-2">Archived</StatusChip>
                ) : null}
                {p.msmeCategory === "micro" || p.msmeCategory === "small" ? (
                  <StatusChip tone="info" className="ml-2">
                    MSME
                  </StatusChip>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {p.gstin ?? "—"}
              </TableCell>
              <TableCell>{REGISTRATION_LABEL[p.registrationType]}</TableCell>
              <TableCell>{p.stateCode ?? "—"}</TableCell>
              <TableCell numeric>
                {p.paymentTermsDays === null
                  ? "Default"
                  : `${p.paymentTermsDays} days`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {page.nextCursor ? (
        <div className="border-t border-default p-3">
          <Link
            href={href(state, { cursor: page.nextCursor })}
            className={buttonVariants({ size: "sm" })}
          >
            Next page
          </Link>
        </div>
      ) : null}
    </>
  )
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const [{ ctx, allowed }, params] = await Promise.all([
    getPageContext("/parties"),
    searchParams,
  ])
  if (!allowed)
    return (
      <PlaceholderPage
        title={TITLE}
        description={DESCRIPTION}
        icon={UsersIcon}
        emptyTitle=""
        emptyDescription=""
        allowed={false}
        role={ctx.role}
      />
    )
  const state: State = {
    kind: firstParam(params.kind) === "vendor" ? "vendor" : "customer",
    q: firstParam(params.q)?.slice(0, 100) ?? null,
    archived: firstParam(params.archived) === "1",
    cursor: firstParam(params.cursor) ?? null,
  }
  const tab = (kind: PartyKind, label: string) => (
    <Link
      href={href(state, { kind, cursor: null })}
      aria-current={state.kind === kind ? "page" : undefined}
      className="rounded-sm px-3 py-1.5 text-sm text-fg-secondary aria-[current=page]:bg-hover aria-[current=page]:font-medium aria-[current=page]:text-fg"
    >
      {label}
    </Link>
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          can(ctx.role, { resource: "ledger", action: "propose" }) ? (
            <Link
              href={`/parties/new?kind=${state.kind}`}
              className={buttonVariants({ variant: "primary", size: "sm" })}
            >
              <PlusIcon aria-hidden />
              New {state.kind}
            </Link>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Customers or vendors" className="flex gap-1">
          {tab("customer", "Customers")}
          {tab("vendor", "Vendors")}
        </nav>
        <form action="/parties" className="flex items-center gap-3">
          {state.kind === "vendor" ? (
            <input type="hidden" name="kind" value="vendor" />
          ) : null}
          <input
            name="q"
            type="search"
            defaultValue={state.q ?? ""}
            placeholder="Name or GSTIN"
            aria-label="Search by name or GSTIN"
            className="h-8 w-56 rounded-sm border border-input bg-surface px-2 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-fg-secondary">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={state.archived}
            />
            Show archived
          </label>
          <button type="submit" className={buttonVariants({ size: "sm" })}>
            Search
          </button>
        </form>
      </div>
      <div className="rounded-lg border border-default bg-surface">
        <Suspense
          key={href(state, {})}
          fallback={
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          }
        >
          <PartyList ctx={ctx} state={state} />
        </Suspense>
      </div>
    </div>
  )
}
