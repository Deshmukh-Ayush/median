import { DownloadIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"

/** Downloads a report as .xlsx (a plain link to /reports/export). */
export function ExcelLink({ params }: { params: Record<string, string> }) {
  return (
    <a
      href={`/reports/export?${new URLSearchParams(params).toString()}`}
      className={buttonVariants({ variant: "ghost" })}
      download
    >
      <DownloadIcon aria-hidden />
      Download Excel
    </a>
  )
}
