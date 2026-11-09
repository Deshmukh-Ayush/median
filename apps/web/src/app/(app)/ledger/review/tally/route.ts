import { isServiceError, isoDateSchema } from "@workspace/contracts"

import { exportTally, requireOrgContext } from "@/server/services"

const STATUS: Partial<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  NO_ACTIVE_ORGANIZATION: 401,
  FORBIDDEN: 403,
  VALIDATION: 422,
}

/**
 * One of the two Tally files for a date range: `file=masters` (ledgers with
 * opening balances; import first) or `file=vouchers`. Built by exportTally.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const from = isoDateSchema.safeParse(params.get("from"))
  const to = isoDateSchema.safeParse(params.get("to"))
  const which = params.get("file")
  if (
    !from.success ||
    !to.success ||
    (which !== "masters" && which !== "vouchers")
  ) {
    return new Response("Pick a date range and a file.", { status: 400 })
  }
  try {
    const ctx = await requireOrgContext()
    const exported = await exportTally(ctx, from.data, to.data)
    const file = exported.files[which === "masters" ? 0 : 1]
    return new Response(file.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^\w.-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    if (isServiceError(error)) {
      return new Response(error.message, { status: STATUS[error.code] ?? 400 })
    }
    throw error
  }
}
