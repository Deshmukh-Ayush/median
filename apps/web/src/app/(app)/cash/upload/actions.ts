"use server"

import { refresh } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { idSchema, isServiceError } from "@workspace/contracts"
import type { BankMatchKind, ImportFile } from "@workspace/contracts"

import { fieldErrorsOf, formValues } from "@/lib/form-state"
import { extractBankStatement } from "@/server/ai/extract-bank-statement"
import { connect, importFile, listConnections } from "@/server/services"

import { getOrgContextOrRedirect } from "../../org-context"
import { MAX_IMPORT_BYTES } from "../../settings/integrations/mode"

export interface StatementUploadResult {
  readonly fileName: string
  readonly accountLabel: string
  readonly source: "csv" | "pdf"
  readonly imported: number
  readonly duplicates: number
  /** Matched by the backend's rules and posted. */
  readonly matched: number
  /** No match: sent to the AI inbox. */
  readonly needsReview: number
  /** 1-based row numbers, as a person counts lines in the file. */
  readonly errors: readonly { readonly row: number; readonly message: string }[]
  /**
   * New lines by row, matched or sent for review. Empty when the importer
   * doesn’t report per-line results.
   */
  readonly lines: readonly StatementLineResult[]
}

export type StatementLineResult =
  | {
      readonly row: number
      readonly status: "matched"
      readonly matchKind: BankMatchKind
    }
  | { readonly row: number; readonly status: "needs_review" }

export type StatementUploadState =
  | { readonly status: "idle" }
  | { readonly status: "error"; readonly error: string }
  | { readonly status: "done"; readonly result: StatementUploadResult }

const RETURN_TO = "/cash/upload"

function kindOf(file: File): "csv" | "pdf" | null {
  const name = file.name.toLowerCase()
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf"
  if (file.type === "text/csv" || name.endsWith(".csv")) return "csv"
  return null
}

/**
 * Bank statement upload. CSV goes straight to importFile; a PDF is read by
 * the AI into BankRow-shaped rows first. Matching and posting happen in the
 * backend; unmatched lines go to the inbox.
 */
export async function uploadBankStatement(
  _previous: StatementUploadState,
  formData: FormData
): Promise<StatementUploadState> {
  const connectionId = idSchema.safeParse(formData.get("connectionId"))
  if (!connectionId.success) {
    return { status: "error", error: "Choose which bank account this is for." }
  }
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "Choose a CSV or PDF statement." }
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return {
      status: "error",
      error: "That file is over 4 MB. Split it by month and try again.",
    }
  }
  const source = kindOf(file)
  if (!source) {
    return { status: "error", error: "Upload a CSV or PDF statement." }
  }

  const ctx = await getOrgContextOrRedirect()
  const account = (await listConnections(ctx)).find(
    (c) => c.id === connectionId.data && c.provider === "bank-statement"
  )
  if (!account) {
    return { status: "error", error: "That bank account isn't connected." }
  }

  try {
    const payload: ImportFile =
      source === "csv"
        ? {
            kind: "text",
            fileName: file.name,
            mimeType: "text/csv",
            text: await file.text(),
          }
        : {
            kind: "rows",
            fileName: file.name,
            rows: await extractBankStatement({
              data: new Uint8Array(await file.arrayBuffer()),
              filename: file.name,
            }),
          }
    const result = await importFile(ctx, "bank-statement", payload, {
      connectionId: account.id,
    })
    refresh()
    return {
      status: "done",
      result: {
        fileName: file.name,
        accountLabel: account.label,
        source,
        imported: result.imported,
        duplicates: result.duplicates,
        matched: result.posted,
        needsReview: result.sentToInbox,
        errors: result.errors.map((e) => ({
          row: e.index + 1,
          message: e.message,
        })),
        lines: [
          ...(result.matched ?? []).map((m): StatementLineResult => ({
            row: m.rowIndex + 1,
            status: "matched",
            matchKind: m.matchKind,
          })),
          ...(result.unmatched ?? []).map((u): StatementLineResult => ({
            row: u.rowIndex + 1,
            status: "needs_review",
          })),
        ].sort((a, b) => a.row - b.row),
      },
    }
  } catch (error) {
    if (isServiceError(error) && error.code === "CONSENT_REQUIRED") {
      redirect(
        `/settings/integrations/consent?next=${encodeURIComponent(RETURN_TO)}`
      )
    }
    if (isServiceError(error)) return { status: "error", error: error.message }
    throw error
  }
}

export interface AddBankAccountState {
  readonly error?: string
  readonly fieldErrors?: Readonly<Record<string, string>>
  readonly values?: Readonly<Record<string, string>>
}

const addBankAccountSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Name the account, e.g. HDFC current a/c.")
    .max(100, "Keep it under 100 characters."),
  ledgerAccountId: idSchema,
})

/**
 * Connects a bank account for statement uploads: a label plus the bank
 * ledger account its lines post to. Owners and finance only (settings).
 */
export async function addBankAccount(
  _previous: AddBankAccountState,
  formData: FormData
): Promise<AddBankAccountState> {
  const raw = formValues(formData, ["label", "ledgerAccountId"])
  const parsed = addBankAccountSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), values: raw }
  }
  const ctx = await getOrgContextOrRedirect()
  try {
    await connect(ctx, "bank-statement", parsed.data)
  } catch (error) {
    if (isServiceError(error) && error.code === "CONSENT_REQUIRED") {
      redirect(
        `/settings/integrations/consent?next=${encodeURIComponent(RETURN_TO)}`
      )
    }
    if (isServiceError(error) && error.code === "FORBIDDEN") {
      return {
        error: "Only an owner or finance member can add a bank account.",
        values: raw,
      }
    }
    if (isServiceError(error)) return { error: error.message, values: raw }
    throw error
  }
  refresh()
  return {}
}
