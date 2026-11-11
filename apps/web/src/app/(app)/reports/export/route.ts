import { isServiceError, reportExportInputSchema } from "@workspace/contracts"

import { exportReport, requireOrgContext } from "@/server/services"

const STATUS: Partial<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  NO_ACTIVE_ORGANIZATION: 401,
  FORBIDDEN: 403,
  VALIDATION: 422,
}

/**
 * A report as .xlsx: `?report=trial_balance&asOf=…`,
 * `?report=profit_and_loss&from=…&to=…`, `?report=balance_sheet&asOf=…` or
 * `?report=receivables_ageing`. Built by exportReport.
 */
export async function GET(request: Request): Promise<Response> {
  const input = reportExportInputSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!input.success)
    return new Response("Pick a report and its dates.", { status: 422 })
  try {
    const ctx = await requireOrgContext()
    const file = await exportReport(ctx, input.data)
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
