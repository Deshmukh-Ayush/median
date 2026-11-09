import { isServiceError, periodSchema } from "@workspace/contracts"

import { exportGstr1, requireOrgContext } from "@/server/services"

const STATUS: Partial<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  NO_ACTIVE_ORGANIZATION: 401,
  FORBIDDEN: 403,
  VALIDATION: 422,
}

/**
 * The month's GSTR-1 draft as the GST offline tool's JSON, for the CA to
 * check and file. Built by exportGstr1; this only serialises it.
 */
export async function GET(request: Request): Promise<Response> {
  const period = periodSchema.safeParse(
    new URL(request.url).searchParams.get("period")
  )
  if (!period.success) {
    return new Response("Pick a month like 2026-10.", { status: 400 })
  }
  try {
    const ctx = await requireOrgContext()
    const draft = await exportGstr1(ctx, period.data)
    // GSTN names files by return, GSTIN and filing period (MMYYYY).
    const fp = `${period.data.slice(5, 7)}${period.data.slice(0, 4)}`
    return new Response(JSON.stringify(draft.payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="GSTR1_${draft.gstin}_${fp}_draft.json"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    if (isServiceError(error)) {
      return new Response(error.message, {
        status: STATUS[error.code] ?? 400,
      })
    }
    throw error
  }
}
