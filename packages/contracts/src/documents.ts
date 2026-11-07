// Uploaded documents (vendor bills, bank statements). Files are stored
// privately; the app only ever sees `url`, a same-origin link that checks the
// session and organisation on every request.

import { z } from "zod"

import type { IsoTimestamp } from "./common"

export type DocumentKind = "bill" | "bank_statement"
export type DocumentStatus = "uploaded" | "extracting" | "extracted" | "failed"

/** File types accepted per kind. The type is detected from the bytes. */
export const DOCUMENT_TYPES = {
  bill: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  bank_statement: ["text/csv", "application/pdf"],
} as const satisfies Record<DocumentKind, readonly string[]>

/** 4 MB: fits Vercel's 4.5 MB request body limit for server uploads. */
export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024

export interface DocumentSummary {
  readonly id: string
  readonly kind: DocumentKind
  readonly fileName: string
  /** Detected from the file's bytes, not the browser's claim. */
  readonly mimeType: string
  readonly status: DocumentStatus
  /** Same-origin, authenticated link: `/api/documents/<id>`. */
  readonly url: string
  readonly uploadedBy: string | null
  readonly createdAt: IsoTimestamp
}

export const registerDocumentInputSchema = z.object({
  kind: z.enum(["bill", "bank_statement"]),
  /** A File from a form (FormData) or any Blob. */
  file: z.instanceof(Blob),
  /** Defaults to the File's name. */
  fileName: z.string().trim().min(1).max(255).optional(),
})
export type RegisterDocumentInput = z.input<typeof registerDocumentInputSchema>
