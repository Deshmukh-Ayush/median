"use client"

import { LockIcon } from "lucide-react"
import { useState, useTransition } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import type { LockPeriodResult } from "@/app/(app)/ledger/review/actions"

/**
 * Pick a month and lock it, after a confirmation: locking can't be undone
 * here (an owner unlocks), and corrections then go in as reversals.
 */
export function LockPeriodForm({
  months,
  lockPeriod,
}: {
  /** [period, label], newest first. */
  months: readonly (readonly [string, string])[]
  lockPeriod: (period: string) => Promise<LockPeriodResult>
}) {
  const [period, setPeriod] = useState(months[1]?.[0] ?? months[0]?.[0] ?? "")
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<LockPeriodResult | null>(null)
  const [pending, startTransition] = useTransition()
  const label = months.find(([p]) => p === period)?.[1] ?? period

  function lock() {
    startTransition(async () => {
      const result = await lockPeriod(period)
      setMessage(result)
      setConfirming(false)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Month
          <select
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value)
              setMessage(null)
            }}
            className="h-8 rounded-sm border border-input bg-surface px-2 text-sm text-fg"
          >
            {months.map(([p, l]) => (
              <option key={p} value={p}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" onClick={() => setConfirming(true)}>
          <LockIcon aria-hidden />
          Lock month
        </Button>
      </div>
      {message ? (
        <p
          role="status"
          className={
            message.ok ? "text-sm text-success" : "text-sm text-danger"
          }
        >
          {message.ok ? `${label} is locked.` : message.error}
        </p>
      ) : null}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock {label}?</DialogTitle>
            <DialogDescription>
              Nothing can be posted, approved or imported into {label} after
              this. Corrections go into an open month as reversals. Only an
              owner can unlock it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={pending}
              onClick={lock}
            >
              Lock {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
