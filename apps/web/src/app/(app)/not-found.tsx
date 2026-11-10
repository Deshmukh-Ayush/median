import Link from "next/link"
import { SearchXIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"

/** A missing invoice, credit note or other record in this organisation. */
export default function AppNotFound() {
  return (
    <div className="p-6">
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<SearchXIcon />}
          title="We couldn't find that"
          description="It may have been in another organisation, or the link is wrong."
          action={
            <Link href="/" className={buttonVariants({ size: "sm" })}>
              Go to Home
            </Link>
          }
        />
      </div>
    </div>
  )
}
