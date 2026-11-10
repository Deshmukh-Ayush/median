"use client"

import { useEffect } from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"

/**
 * Any screen that throws lands here, inside the app shell, so the sidebar
 * still works. Server errors reach the client without their message in
 * production; the digest matches the server log line.
 */
export default function AppError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : null

  return (
    <div className="p-6">
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<TriangleAlertIcon />}
          title="This screen didn't load"
          description={
            <>
              Your books are safe: nothing was changed. Try again, and if it
              keeps happening, send us the reference below.
              {digest ? (
                <span className="mt-2 block font-mono text-xs">
                  Reference {digest}
                </span>
              ) : null}
            </>
          }
          action={
            <Button variant="primary" size="sm" onClick={() => retry()}>
              Try again
            </Button>
          }
        />
      </div>
    </div>
  )
}
