import { runScheduledSyncs } from "@/server/services"

import { checkCronAuth } from "./auth"

/** Up to 500 connections, one at a time: allow the platform maximum. */
export const maxDuration = 300

/**
 * Daily scheduled sync (vercel.json crons). Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET`; anything else gets 401. The report
 * only holds counts, connection ids and messages that are safe to show.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = checkCronAuth(request.headers.get("authorization"))
  if (auth === "not_configured") {
    console.error("[cron/sync] CRON_SECRET is not set; refusing to run.")
    return Response.json({ error: "Not configured" }, { status: 503 })
  }
  if (auth === "unauthorized") {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const report = await runScheduledSyncs()
  if (report.failed.length > 0) {
    console.warn(
      `[cron/sync] ${report.failed.length} connection(s) failed to sync.`
    )
  }
  return Response.json(report)
}
