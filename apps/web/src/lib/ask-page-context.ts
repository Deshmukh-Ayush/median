import { idSchema, isoDateSchema, periodSchema } from "@workspace/contracts"

import type { AskPageContext } from "./ask-context"

type Period = NonNullable<AskPageContext["period"]>

interface Params {
  get(name: string): string | null
}

const date = (v: string | null) =>
  v !== null && isoDateSchema.safeParse(v).success ? v : null
const month = (v: string | null) =>
  v !== null && periodSchema.safeParse(v).success ? v : null
const id = (v: string | undefined) =>
  v !== undefined && idSchema.safeParse(v).success ? v : null

function periodOf(path: string, params: Params): Period | undefined {
  if (path === "/gst") {
    const m = month(params.get("period"))
    return m ? { month: m } : undefined
  }
  const from = date(params.get("from"))
  const to = date(params.get("to"))
  if (from && to && from <= to) return { from, to }
  const asOf = date(params.get("asOf"))
  return asOf ? { asOf } : undefined
}

/**
 * What the Ask sheet tells the model about the current page, from the URL:
 * the record ids in the path (an invoice, a party, a credit note), the
 * period in the query (a GST month, a report range or as-of date), plus any
 * ids the page itself registered (the inbox item in focus). Only validated
 * ids and dates go in.
 */
export function pageContextFromRoute(
  pathname: string,
  params: Params,
  selectedIds: readonly string[] = []
): AskPageContext & { readonly ids: readonly string[] } {
  const path = /^\/[\w\-/]*$/.test(pathname) ? pathname : "/"
  const segments = path.split("/").filter(Boolean)
  const pathIds = segments.flatMap((s) => {
    const v = id(s)
    return v ? [v] : []
  })
  const ids = [
    ...new Set([...pathIds, ...selectedIds.flatMap((s) => id(s) ?? [])]),
  ].slice(0, 10)
  const period = periodOf(path, params)
  return { page: path, ids, ...(period ? { period } : {}) }
}
