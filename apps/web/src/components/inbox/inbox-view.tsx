"use client"

import * as React from "react"
import { toast } from "sonner"
import { CheckIcon, InboxIcon, XIcon } from "lucide-react"

import type { Money as MoneyValue } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { ConfidenceBadge } from "@workspace/ui/components/confidence-badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Kbd } from "@workspace/ui/components/kbd"
import { Money } from "@workspace/ui/components/money"
import { SourceLink } from "@workspace/ui/components/source-link"
import { StatusChip } from "@workspace/ui/components/status-chip"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "cn"

import type { InboxActionResult } from "@/app/(app)/inbox/actions"

export interface InboxLineView {
  account: string
  amount: MoneyValue
  description: string | null
}

/** One inbox item, prepared on the server for display. */
export interface InboxRowView {
  id: string
  kindLabel: string
  confidence: number
  reason: string
  narration: string
  entryDate: string
  createdAt: string
  /** The entry's total (sum of its debit lines). */
  amount: MoneyValue
  /** Where the money is recorded (debit lines), in founder words. */
  goesTo: InboxLineView[]
  /** Where it comes from (credit lines). */
  comesFrom: InboxLineView[]
  sourceLabel: string
}

interface InboxViewProps {
  rows: InboxRowView[]
  canApprove: boolean
  canReject: boolean
  approveItems: (ids: string[]) => Promise<InboxActionResult>
  rejectItem: (id: string, reason: string) => Promise<InboxActionResult>
}

const SHORTCUTS: readonly {
  keys: string[]
  label: string
  needs?: "approve" | "reject"
}[] = [
  { keys: ["j", "k"], label: "move" },
  { keys: ["a"], label: "approve", needs: "approve" },
  { keys: ["r"], label: "reject", needs: "reject" },
  { keys: ["x"], label: "select", needs: "approve" },
]

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

export function InboxView({
  rows,
  canApprove,
  canReject,
  approveItems,
  rejectItem,
}: InboxViewProps) {
  // Items done this session are hidden at once; the server refresh follows.
  const [done, setDone] = React.useState<ReadonlySet<string>>(new Set())
  const visible = React.useMemo(
    () => rows.filter((r) => !done.has(r.id)),
    [rows, done]
  )
  const [activeId, setActiveId] = React.useState<string | null>(
    rows[0]?.id ?? null
  )
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set())
  const [rejecting, setRejecting] = React.useState<InboxRowView | null>(null)
  const [pending, startTransition] = React.useTransition()
  const listRef = React.useRef<HTMLUListElement>(null)

  const activeIndex = Math.max(
    0,
    visible.findIndex((r) => r.id === activeId)
  )
  const active = visible[activeIndex] ?? null

  const markDone = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      // Keep the position: select the next remaining item, not the first.
      if (activeId && ids.includes(activeId)) {
        const from = visible.findIndex((r) => r.id === activeId)
        const remaining = visible.filter((r) => !ids.includes(r.id))
        const next = remaining[Math.min(from, remaining.length - 1)]
        setActiveId(next?.id ?? null)
      }
      setDone((prev) => new Set([...prev, ...ids]))
      setChecked((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
    },
    [activeId, visible]
  )

  const approve = React.useCallback(
    (ids: string[]) => {
      if (!canApprove || ids.length === 0 || pending) return
      startTransition(async () => {
        const result = await approveItems(ids)
        markDone(result.ids)
        if (result.ok) {
          toast.success(
            ids.length === 1
              ? "Approved and posted."
              : `${result.ids.length} items approved and posted.`
          )
        } else {
          toast.error(
            result.ids.length > 0
              ? `${result.ids.length} approved, then: ${result.error}`
              : result.error
          )
        }
      })
    },
    [approveItems, canApprove, markDone, pending]
  )

  const move = React.useCallback(
    (delta: number) => {
      const next = visible[activeIndex + delta]
      if (!next) return
      setActiveId(next.id)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)
        ?.scrollIntoView({ block: "nearest" })
    },
    [activeIndex, visible]
  )

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target) || rejecting) return
      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault()
          move(1)
          break
        case "k":
        case "ArrowUp":
          event.preventDefault()
          move(-1)
          break
        // preventDefault stops the key reaching a field the action focuses.
        case "a":
          event.preventDefault()
          if (active) approve([active.id])
          break
        case "r":
          event.preventDefault()
          if (active && canReject) setRejecting(active)
          break
        case "x":
          event.preventDefault()
          if (active) toggle(active.id)
          break
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<InboxIcon />}
          title="You're all caught up"
          description="When the AI reads a bill or matches a bank line, it lands here for your approval."
        />
      </div>
    )
  }

  const checkedIds = visible.filter((r) => checked.has(r.id)).map((r) => r.id)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center gap-3 text-xs text-fg-secondary">
        {checkedIds.length > 0 && canApprove ? (
          <>
            <span className="tabular">{checkedIds.length} selected</span>
            <Button
              size="sm"
              variant="primary"
              loading={pending}
              onClick={() => approve(checkedIds)}
            >
              Approve {checkedIds.length}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChecked(new Set())}
            >
              Clear
            </Button>
          </>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {SHORTCUTS.filter(
              (h) =>
                (h.needs === "approve" && canApprove) ||
                (h.needs === "reject" && canReject) ||
                !h.needs
            ).map((h) => (
              <span key={h.label} className="flex items-center gap-1">
                {h.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
                {h.label}
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul
          ref={listRef}
          aria-label="Items to review"
          className="flex flex-col self-start overflow-hidden rounded-lg border border-default bg-surface"
        >
          {visible.map((row) => {
            const isActive = row.id === active?.id
            return (
              <li
                key={row.id}
                data-id={row.id}
                className={cn(
                  "flex items-start gap-3 border-b border-subtle px-3 py-3 last:border-b-0",
                  isActive && "bg-selected"
                )}
              >
                {canApprove ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.narration}`}
                    className="mt-1 size-4 shrink-0 accent-[var(--color-accent-button)]"
                    checked={checked.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                ) : null}
                <button
                  type="button"
                  aria-current={isActive || undefined}
                  onClick={() => setActiveId(row.id)}
                  className="flex min-w-0 flex-1 flex-col gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {row.narration}
                    </span>
                    <Money value={row.amount} className="shrink-0 text-sm" />
                  </span>
                  <span className="flex items-center gap-2 text-xs text-fg-secondary">
                    <StatusChip>{row.kindLabel}</StatusChip>
                    <ConfidenceBadge score={row.confidence} />
                    <span className="ml-auto shrink-0">{row.createdAt}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {active ? (
          <InboxDetail
            row={active}
            canApprove={canApprove}
            canReject={canReject}
            pending={pending}
            onApprove={() => approve([active.id])}
            onReject={() => setRejecting(active)}
          />
        ) : null}
      </div>

      <RejectDialog
        row={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={(id) => {
          markDone([id])
          setRejecting(null)
          toast.success("Rejected. Nothing was posted.")
        }}
        rejectItem={rejectItem}
      />
    </div>
  )
}

function InboxDetail({
  row,
  canApprove,
  canReject,
  pending,
  onApprove,
  onReject,
}: {
  row: InboxRowView
  canApprove: boolean
  canReject: boolean
  pending: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <section
      aria-label="Selected item"
      className="flex flex-col gap-5 rounded-lg border border-default bg-surface p-4 lg:sticky lg:top-4 lg:self-start"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip>{row.kindLabel}</StatusChip>
          <ConfidenceBadge score={row.confidence} reason={row.reason} />
        </div>
        <h2 className="text-base font-semibold">{row.narration}</h2>
        <p className="text-sm text-fg-secondary">{row.reason}</p>
        <SourceLink>{row.sourceLabel}</SourceLink>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-fg-secondary">Date</dt>
          <dd>{row.entryDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-secondary">Amount</dt>
          <dd>
            <Money value={row.amount} />
          </dd>
        </div>
      </dl>

      <LineGroup title="Recorded as" lines={row.goesTo} />
      <LineGroup title="Paid from or owed to" lines={row.comesFrom} />

      {canApprove || canReject ? (
        <footer className="flex flex-wrap gap-2 border-t border-subtle pt-4">
          {canApprove ? (
            <Button variant="primary" loading={pending} onClick={onApprove}>
              <CheckIcon aria-hidden /> Approve <Kbd>a</Kbd>
            </Button>
          ) : null}
          {canReject ? (
            <Button variant="danger" disabled={pending} onClick={onReject}>
              <XIcon aria-hidden /> Reject <Kbd>r</Kbd>
            </Button>
          ) : null}
        </footer>
      ) : (
        <p className="border-t border-subtle pt-4 text-xs text-fg-secondary">
          Your role can view the inbox but not approve or reject items.
        </p>
      )}
    </section>
  )
}

function LineGroup({
  title,
  lines,
}: {
  title: string
  lines: InboxLineView[]
}) {
  if (lines.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-fg-secondary">{title}</h3>
      <ul className="flex flex-col divide-y divide-subtle rounded-md border border-subtle">
        {lines.map((line, i) => (
          <li
            key={`${line.account}-${i}`}
            className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate">{line.account}</span>
              {line.description ? (
                <span className="block truncate text-xs text-fg-secondary">
                  {line.description}
                </span>
              ) : null}
            </span>
            <Money value={line.amount} className="shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  )
}

function RejectDialog({
  row,
  onClose,
  onRejected,
  rejectItem,
}: {
  row: InboxRowView | null
  onClose: () => void
  onRejected: (id: string) => void
  rejectItem: (id: string, reason: string) => Promise<InboxActionResult>
}) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!row) return
    const id = row.id
    startTransition(async () => {
      const result = await rejectItem(id, reason)
      if (result.ok) {
        setReason("")
        setError(null)
        onRejected(id)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null)
          onClose()
        }
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Reject this item?</DialogTitle>
            <DialogDescription>
              {row?.narration}. Nothing is posted to your books.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm">
            Reason
            <Textarea
              autoFocus
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: duplicate of last week's bill"
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
