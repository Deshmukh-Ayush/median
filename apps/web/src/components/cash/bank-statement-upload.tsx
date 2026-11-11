"use client"

import Link from "next/link"
import { cn } from "cn"
import { useActionState } from "react"
import type { ReactNode } from "react"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CopyIcon,
  InboxIcon,
} from "lucide-react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { uploadBankStatement } from "@/app/(app)/cash/upload/actions"
import type {
  StatementLineResult,
  StatementUploadResult,
  StatementUploadState,
} from "@/app/(app)/cash/upload/actions"
import { FormError } from "@/components/forms/field"

const INITIAL: StatementUploadState = { status: "idle" }

/** Counts in Indian grouping (1,23,456). */
const count = new Intl.NumberFormat("en-IN")

/** Rows shown in each table before "and N more". */
const ROWS_SHOWN = 50

/** Founder language for what a line matched. */
const MATCH_LABELS: Record<
  Extract<StatementLineResult, { status: "matched" }>["matchKind"],
  string
> = {
  razorpay_settlement: "Razorpay settlement",
  invoice_payment: "Invoice payment",
  known_vendor: "Known vendor",
  bill_payment: "Bill payment",
}

export function BankStatementUpload({
  accounts,
}: {
  accounts: readonly { id: string; label: string }[]
}) {
  const [state, action, pending] = useActionState(uploadBankStatement, INITIAL)
  return (
    <div className="flex flex-col gap-6">
      <form
        action={action}
        className="flex max-w-md flex-col gap-4 rounded-lg border border-default bg-surface p-5"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="statement-account">Bank account</Label>
          <select
            id="statement-account"
            name="connectionId"
            required
            className="h-8 rounded-sm border border-input bg-surface px-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="statement-file">Statement</Label>
          <input
            id="statement-file"
            name="file"
            type="file"
            required
            accept="text/csv,.csv,application/pdf,.pdf"
            aria-describedby="statement-file-hint"
            className="text-sm file:mr-3 file:h-8 file:rounded-sm file:border file:border-input file:bg-surface file:px-2.5 file:text-sm"
          />
          <p id="statement-file-hint" className="text-xs text-fg-secondary">
            CSV export or PDF, up to 4 MB. PDFs are read by AI, which takes a
            little longer. Uploading the same statement twice is safe.
          </p>
        </div>
        <FormError
          message={state.status === "error" ? state.error : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          className="self-start"
        >
          Upload and match
        </Button>
      </form>

      {state.status === "done" ? <MatchResults result={state.result} /> : null}
    </div>
  )
}

/** What the import did: matched and posted, sent for review, unreadable. */
export function MatchResults({ result }: { result: StatementUploadResult }) {
  const shownErrors = result.errors.slice(0, ROWS_SHOWN)
  const hiddenErrors = result.errors.length - shownErrors.length
  return (
    <section
      aria-labelledby="match-results"
      aria-live="polite"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 id="match-results" className="text-sm font-semibold">
          {result.fileName}
        </h2>
        <span className="text-xs text-fg-secondary">
          {result.accountLabel} ·{" "}
          {result.source === "pdf" ? "PDF, read by AI" : "CSV"} ·{" "}
          {count.format(result.imported)} new{" "}
          {result.imported === 1 ? "line" : "lines"}
        </span>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        <Tile
          icon={<CheckCircle2Icon />}
          label="Matched and posted"
          value={result.matched}
          tone="success"
        />
        <Tile
          icon={<InboxIcon />}
          label="Needs review"
          value={result.needsReview}
          tone={result.needsReview > 0 ? "warning" : "neutral"}
          action={
            result.needsReview > 0 ? (
              <Link
                href="/inbox"
                className={cn(
                  buttonVariants({ size: "sm", variant: "secondary" }),
                  "self-start"
                )}
              >
                Review in inbox
              </Link>
            ) : null
          }
        />
        <Tile
          icon={<CopyIcon />}
          label="Already imported"
          value={result.duplicates}
          tone="neutral"
        />
      </ul>

      {result.lines.length > 0 ? <LineResults lines={result.lines} /> : null}

      {result.errors.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-4">
          <div className="flex items-center gap-2">
            <CircleAlertIcon aria-hidden className="size-4 text-danger" />
            <h3 className="text-sm font-medium">
              {count.format(result.errors.length)}{" "}
              {result.errors.length === 1 ? "line" : "lines"} we couldn&apos;t
              read
            </h3>
          </div>
          <p className="text-xs text-fg-secondary">
            These weren&apos;t imported. Fix them in the file and upload it
            again; lines already imported are skipped.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-secondary">
              <tr>
                <th scope="col" className="w-20 py-1 font-medium">
                  Line
                </th>
                <th scope="col" className="py-1 font-medium">
                  Problem
                </th>
              </tr>
            </thead>
            <tbody>
              {shownErrors.map((e) => (
                <tr key={e.row} className="border-t border-default">
                  <td className="py-1.5 tabular-nums">{e.row}</td>
                  <td className="py-1.5">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hiddenErrors > 0 ? (
            <p className="text-xs text-fg-secondary">
              and {count.format(hiddenErrors)} more.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function LineResults({ lines }: { lines: readonly StatementLineResult[] }) {
  const shown = lines.slice(0, ROWS_SHOWN)
  const hidden = lines.length - shown.length
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-4">
      <h3 className="text-sm font-medium">Line by line</h3>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-fg-secondary">
          <tr>
            <th scope="col" className="w-20 py-1 font-medium">
              Line
            </th>
            <th scope="col" className="py-1 font-medium">
              Result
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((line) => (
            <tr key={line.row} className="border-t border-default">
              <td className="py-1.5 tabular-nums">{line.row}</td>
              <td className="py-1.5">
                {line.status === "matched" ? (
                  <StatusChip tone="success">
                    Matched: {MATCH_LABELS[line.matchKind]}
                  </StatusChip>
                ) : (
                  <StatusChip tone="warning">Needs review</StatusChip>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 ? (
        <p className="text-xs text-fg-secondary">
          and {count.format(hidden)} more.
        </p>
      ) : null}
    </div>
  )
}

function Tile({
  icon,
  label,
  value,
  tone,
  action,
}: {
  icon: ReactNode
  label: string
  value: number
  tone: "success" | "warning" | "neutral"
  action?: ReactNode
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-default bg-surface p-4">
      <StatusChip tone={tone} className="[&>svg]:size-3">
        {icon}
        {label}
      </StatusChip>
      <p className="text-2xl font-display font-semibold tabular-nums">
        {count.format(value)}
      </p>
      {action}
    </li>
  )
}
