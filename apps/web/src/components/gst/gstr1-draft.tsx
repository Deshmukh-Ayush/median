import { DownloadIcon, TriangleAlertIcon } from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import type { Period } from "@workspace/contracts"
import { buttonVariants } from "@workspace/ui/components/button"

import { exportGstr1 } from "@/server/services"
import type { OrgContext } from "@/server/services"

/** Where the GSTR-1 draft for a month downloads from. */
export const gstr1Href = (period: Period) => `/gst/gstr1?period=${period}`

/**
 * The GSTR-1 draft: what the CA must check (from exportGstr1's warnings)
 * and the download. Built here so problems show before downloading.
 */
export async function Gstr1Draft({
  ctx,
  period,
  canExport,
}: {
  ctx: OrgContext
  period: Period
  canExport: boolean
}) {
  let warnings: readonly string[] = []
  let blocked: string | null = null
  if (canExport) {
    try {
      warnings = (await exportGstr1(ctx, period)).warnings
    } catch (error) {
      if (!isServiceError(error)) throw error
      blocked = error.message
    }
  } else {
    blocked = "Only owners, finance and your CA can download returns."
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {blocked ? (
          <span
            aria-disabled
            className={buttonVariants({
              size: "sm",
              className: "pointer-events-none opacity-50",
            })}
          >
            <DownloadIcon aria-hidden />
            Download GSTR-1 (draft)
          </span>
        ) : (
          <a
            href={gstr1Href(period)}
            download
            className={buttonVariants({ size: "sm" })}
          >
            <DownloadIcon aria-hidden />
            Download GSTR-1 (draft)
          </a>
        )}
        {blocked ? (
          <span className="text-xs text-fg-secondary">{blocked}</span>
        ) : null}
      </div>
      <p className="text-xs text-fg-secondary">
        This is a draft in the GST offline tool&apos;s format. Your CA loads it
        into the offline tool, checks it and files; Median doesn&apos;t file
        returns for you.
      </p>
      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-warning">
              <TriangleAlertIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
              />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
