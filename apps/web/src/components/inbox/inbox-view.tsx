"use client"

import * as React from "react"
import { toast } from "sonner"
import { CheckIcon, InboxIcon, PencilIcon, XIcon } from "lucide-react"

import type { Money as MoneyValue, TdsSection } from "@workspace/contracts"
import { formatInr } from "@workspace/ledger"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
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

import type { InboxActionResult, TaxEditsForm } from "@/app/(app)/inbox/actions"

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
  /** Signed URL of the bill or statement; null for API records. */
  sourceUrl: string | null
  gst: {
    taxable: MoneyValue
    cgst: MoneyValue
    sgst: MoneyValue
    igst: MoneyValue
    /** "18%", or null when lines carry different rates. */
    rateLabel: string | null
    interstate: boolean
  } | null
  tds: { section: TdsSection; rate: string; amount: MoneyValue } | null
  /** Whether the reviewer may correct GST and TDS before approving. */
  taxEditable: boolean
  /** Fields extraction checks want a human to look at. */
  flags: { field: string; reason: string }[]
  /** A refund of an invoiced sale: raise a credit note before approving. */
  refund: { href: string; invoiceNumber: string; amount: MoneyValue } | null
}

interface InboxViewProps {
  rows: InboxRowView[]
  canApprove: boolean
  canReject: boolean
  /** TDS sections the reviewer can pick; passed in to keep zod off the client. */
  tdsSections: readonly TdsSection[]
  approveItem: (id: string, edits: TaxEditsForm) => Promise<InboxActionResult>
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
  tdsSections,
  approveItem,
  approveItems,
  rejectItem,
}: InboxViewProps) {
  // Tax corrections for one item, kept here so the `a` shortcut sends them.
  const [draft, setDraft] = React.useState<{
    id: string
    edits: TaxEditsForm
  } | null>(null)
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
      // Bulk approval posts proposals as they are, so it can't carry edits.
      if (ids.length > 1 && draft && ids.includes(draft.id)) {
        toast.error(
          "One selected item has tax edits. Approve it on its own first."
        )
        return
      }
      startTransition(async () => {
        const [only] = ids
        const result =
          ids.length === 1 && only
            ? await approveItem(only, draft?.id === only ? draft.edits : {})
            : await approveItems(ids)
        markDone(result.ids)
        if (result.ids.some((id) => id === draft?.id)) setDraft(null)
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
    [approveItem, approveItems, canApprove, draft, markDone, pending]
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
                    className="mt-1 size-4 shrink-0"
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
            // Remount per item so a half-typed edit never leaks across.
            key={active.id}
            row={active}
            canApprove={canApprove}
            canReject={canReject}
            pending={pending}
            tdsSections={tdsSections}
            edits={draft?.id === active.id ? draft.edits : null}
            onEdit={(edits) =>
              setDraft(edits ? { id: active.id, edits } : null)
            }
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
  tdsSections,
  edits,
  onEdit,
  onApprove,
  onReject,
}: {
  row: InboxRowView
  canApprove: boolean
  canReject: boolean
  pending: boolean
  tdsSections: readonly TdsSection[]
  edits: TaxEditsForm | null
  onEdit: (edits: TaxEditsForm | null) => void
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
        {row.refund && canApprove ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-info-subtle px-3 py-2 text-sm">
            <span className="flex-1 text-info">
              Refund of{" "}
              <Money value={row.refund.amount} className="text-info" /> against{" "}
              {row.refund.invoiceNumber}. Create the credit note first, then
              approve this payout.
            </span>
            <a
              href={row.refund.href}
              className={buttonVariants({ size: "sm", variant: "primary" })}
            >
              Create credit note
            </a>
          </div>
        ) : null}
        {row.sourceUrl ? (
          <SourceLink href={row.sourceUrl} target="_blank" rel="noreferrer">
            {row.sourceLabel}
          </SourceLink>
        ) : (
          <SourceLink kind="payment">{row.sourceLabel}</SourceLink>
        )}
      </header>

      {row.flags.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md bg-warning-subtle px-3 py-2 text-sm">
          <h3 className="text-xs font-medium text-warning">Check these</h3>
          <ul className="flex flex-col gap-0.5">
            {row.flags.map((flag) => (
              <li key={`${flag.field}-${flag.reason}`}>
                <span className="font-mono text-xs">{flag.field}</span>:{" "}
                {flag.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

      {row.gst || row.tds || (row.taxEditable && canApprove) ? (
        <TaxSection
          row={row}
          editable={row.taxEditable && canApprove}
          tdsSections={tdsSections}
          edits={edits}
          onEdit={onEdit}
        />
      ) : null}

      {canApprove || canReject ? (
        <footer className="flex flex-wrap gap-2 border-t border-subtle pt-4">
          {canApprove ? (
            <Button variant="primary" loading={pending} onClick={onApprove}>
              <CheckIcon aria-hidden />{" "}
              {edits ? "Approve with edits" : "Approve"} <Kbd>a</Kbd>
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

const rupees = (amount: MoneyValue) => formatInr(amount, { symbol: false })

function initialEdits(row: InboxRowView): TaxEditsForm {
  return {
    ...(row.gst
      ? {
          gst: {
            taxable: rupees(row.gst.taxable),
            cgst: rupees(row.gst.cgst),
            sgst: rupees(row.gst.sgst),
            igst: rupees(row.gst.igst),
          },
        }
      : {}),
    ...(row.tds
      ? {
          tds: {
            section: row.tds.section,
            rate: row.tds.rate,
            amount: rupees(row.tds.amount),
          },
        }
      : {}),
  }
}

/**
 * The GST split and TDS behind the entry. Reviewers can correct them; the
 * backend rebuilds the tax lines from what they type and checks the entry
 * balances. Nothing is calculated here.
 */
function TaxSection({
  row,
  editable,
  tdsSections,
  edits,
  onEdit,
}: {
  row: InboxRowView
  editable: boolean
  tdsSections: readonly TdsSection[]
  edits: TaxEditsForm | null
  onEdit: (edits: TaxEditsForm | null) => void
}) {
  const fieldId = (name: string) => `tax-${row.id}-${name}`

  if (!edits) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-fg-secondary">Tax</h3>
          {editable ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(initialEdits(row))}
            >
              <PencilIcon aria-hidden /> Edit GST and TDS
            </Button>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-subtle px-3 py-2 text-sm">
          {row.gst ? (
            <>
              <dt className="text-fg-secondary">
                Taxable value
                {row.gst.rateLabel ? ` · GST ${row.gst.rateLabel}` : ""}
              </dt>
              <dd className="text-right">
                <Money value={row.gst.taxable} />
              </dd>
              {row.gst.interstate ? (
                <>
                  <dt className="text-fg-secondary">IGST</dt>
                  <dd className="text-right">
                    <Money value={row.gst.igst} />
                  </dd>
                </>
              ) : (
                <>
                  <dt className="text-fg-secondary">CGST</dt>
                  <dd className="text-right">
                    <Money value={row.gst.cgst} />
                  </dd>
                  <dt className="text-fg-secondary">SGST</dt>
                  <dd className="text-right">
                    <Money value={row.gst.sgst} />
                  </dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt className="text-fg-secondary">GST</dt>
              <dd className="text-right text-fg-secondary">None</dd>
            </>
          )}
          <dt className="text-fg-secondary">
            TDS{row.tds ? ` · ${row.tds.section} at ${row.tds.rate}%` : ""}
          </dt>
          <dd className="text-right">
            {row.tds ? (
              <Money value={row.tds.amount} />
            ) : (
              <span className="text-fg-secondary">None</span>
            )}
          </dd>
        </dl>
      </div>
    )
  }

  const gst = edits.gst
  const tds = edits.tds
  const setGst = (key: "taxable" | "cgst" | "sgst" | "igst", value: string) =>
    gst && onEdit({ ...edits, gst: { ...gst, [key]: value } })
  const setTds = (key: "section" | "rate" | "amount", value: string) =>
    tds && onEdit({ ...edits, tds: { ...tds, [key]: value } })

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-default p-3">
      <legend className="px-1 text-xs font-medium text-fg-secondary">
        Edit GST and TDS
      </legend>
      {gst ? (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["taxable", "Taxable value"],
              ["cgst", "CGST"],
              ["sgst", "SGST"],
              ["igst", "IGST"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId(key)}>{label} (₹)</Label>
              <Input
                id={fieldId(key)}
                inputMode="decimal"
                autoComplete="off"
                className="text-right tabular"
                value={gst[key]}
                onChange={(e) => setGst(key, e.target.value)}
              />
            </div>
          ))}
          <p className="col-span-2 text-xs text-fg-secondary">
            Use CGST + SGST for sales within your state, IGST otherwise.
          </p>
        </div>
      ) : null}

      {tds ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("tds-section")}>TDS section</Label>
            <select
              id={fieldId("tds-section")}
              value={tds.section}
              onChange={(e) => setTds("section", e.target.value)}
              className="h-8 rounded-sm border border-input bg-surface px-2 text-sm"
            >
              {tdsSections.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("tds-rate")}>Rate (%)</Label>
            <Input
              id={fieldId("tds-rate")}
              inputMode="decimal"
              autoComplete="off"
              className="text-right tabular"
              value={tds.rate}
              onChange={(e) => setTds("rate", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("tds-amount")}>TDS (₹)</Label>
            <Input
              id={fieldId("tds-amount")}
              inputMode="decimal"
              autoComplete="off"
              className="text-right tabular"
              value={tds.amount}
              onChange={(e) => setTds("amount", e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="col-span-3 justify-self-start"
            onClick={() => {
              const { tds: _removed, ...rest } = edits
              // Null tells the backend to drop proposed TDS; omitted keeps none.
              onEdit(row.tds ? { ...rest, tds: null } : rest)
            }}
          >
            Remove TDS
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onClick={() =>
            onEdit({
              ...edits,
              tds: row.tds
                ? {
                    section: row.tds.section,
                    rate: row.tds.rate,
                    amount: rupees(row.tds.amount),
                  }
                : { section: tdsSections[0] ?? "194J", rate: "", amount: "" },
            })
          }
        >
          {tds === null ? "Keep the proposed TDS" : "Add TDS"}
        </Button>
      )}

      <p className="text-xs text-fg-secondary">
        Median rebuilds the tax lines from these and checks the entry balances
        before posting.
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => onEdit(null)}
      >
        Discard edits
      </Button>
    </fieldset>
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
