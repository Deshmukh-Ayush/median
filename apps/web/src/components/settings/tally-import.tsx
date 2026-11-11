"use client"

import Link from "next/link"
import { CheckCircle2Icon, FileUpIcon, TriangleAlertIcon } from "lucide-react"
import { startTransition, useActionState, useRef, useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Money } from "@workspace/ui/components/money"
import { StatusChip } from "@workspace/ui/components/status-chip"

import type { TallyImportState } from "@/app/(app)/settings/import/actions"

const INITIAL: TallyImportState = { status: "idle" }

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Upload → confirm → import → trial-balance check. Nothing is posted until
 * the user confirms; the numbers shown afterwards are importFile's.
 */
export function TallyImport({
  importTallyFile,
}: {
  importTallyFile: (
    previous: TallyImportState,
    formData: FormData
  ) => Promise<TallyImportState>
}) {
  const [state, action, pending] = useActionState(importTallyFile, INITIAL)
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function run() {
    if (!file) return
    const formData = new FormData()
    formData.set("file", file)
    startTransition(() => action(formData))
  }

  function reset() {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  // A finished import stays on screen until "Import another file".
  const [dismissed, setDismissed] = useState<TallyImportState | null>(null)
  if (state.status === "done" && !pending && state !== dismissed) {
    return (
      <Result
        state={state}
        onAnother={() => {
          reset()
          setDismissed(state)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5">
        <h2 className="text-sm font-semibold">1. Choose your Tally export</h2>
        <p className="text-sm text-fg-secondary">
          In Tally: Gateway of Tally → Export → Masters, then Day Book (or
          Vouchers), format XML. Import the masters file first, then the
          vouchers. One file with both works too.
        </p>
        <label className="flex w-fit cursor-pointer items-center gap-2">
          <span className={buttonVariants({ size: "sm" })}>
            <FileUpIcon aria-hidden />
            Choose XML file
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="text-sm text-fg-secondary">
            {file ? `${file.name} · ${sizeLabel(file.size)}` : "No file chosen"}
          </span>
        </label>
      </section>

      {file ? (
        <section className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-5">
          <h2 className="text-sm font-semibold">2. Import into your books</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-secondary">
            <li>
              Tally ledgers become accounts, customers and vendors in Median.
            </li>
            <li>Opening balances and every voucher are posted as entries.</li>
            <li>
              Importing the same file again adds nothing twice. Entries can only
              be undone by reversing them.
            </li>
          </ul>
          {state.status === "error" ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" loading={pending} onClick={run}>
              Import {file.name}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Choose another file
            </Button>
          </div>
        </section>
      ) : state.status === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </div>
  )
}

function Result({
  state,
  onAnother,
}: {
  state: Extract<TallyImportState, { status: "done" }>
  onAnother: () => void
}) {
  const { result } = state
  const tally = result.tally
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-default bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">3. Check: {state.fileName}</h2>
        <p className="text-sm text-fg-secondary">
          {result.imported} new records, {result.posted} posted
          {result.duplicates > 0
            ? `, ${result.duplicates} already imported before`
            : ""}
          {result.errors.length > 0
            ? `, ${result.errors.length} couldn't be read`
            : ""}
          .
        </p>
      </div>

      {tally ? (
        tally.trialBalanceMatches ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2Icon aria-hidden className="size-4" />
            Trial balance matches Tally: every ledger&apos;s balance in Median
            equals the file&apos;s.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <StatusChip tone="danger" dot>
              Trial balance doesn&apos;t match Tally
            </StatusChip>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-secondary">
                  <tr className="[&>th]:py-1.5 [&>th]:pr-4 [&>th]:font-medium">
                    <th>Tally ledger</th>
                    <th className="text-right">In the Tally file</th>
                    <th className="text-right">Booked in Median</th>
                  </tr>
                </thead>
                <tbody>
                  {tally.differences.map((d) => (
                    <tr
                      key={d.accountId + d.ledgers.join()}
                      className="border-t border-faint [&>td]:py-1.5 [&>td]:pr-4"
                    >
                      <td>{d.ledgers.join(", ")}</td>
                      <td className="text-right">
                        <Money value={d.expectedDebit} variant="ledger" />
                      </td>
                      <td className="text-right">
                        <Money value={d.bookedDebit} variant="ledger" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-fg-secondary">
              Net debit balances; credits in brackets. Vouchers that
              couldn&apos;t post (see below) usually explain the difference.
            </p>
          </div>
        )
      ) : null}

      {tally && tally.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {tally.warnings.map((w) => (
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

      {result.errors.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-fg-secondary">
            {result.errors.length} items couldn&apos;t be read
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {result.errors.slice(0, 50).map((e) => (
              <li key={`${e.index}:${e.message}`}>
                Item {e.index + 1}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href="/ledger?view=trial-balance"
          className={buttonVariants({ size: "sm", variant: "primary" })}
        >
          Open trial balance
        </Link>
        <Button size="sm" onClick={onAnother}>
          Import another file
        </Button>
      </div>
    </section>
  )
}
