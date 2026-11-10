import "server-only"

import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  ServiceError,
  idSchema,
  parseInput,
  registerDocumentInputSchema,
} from "@workspace/contracts"
import type {
  DocumentKind,
  DocumentSummary,
  RegisterDocumentInput,
} from "@workspace/contracts"
import { and, eq } from "drizzle-orm"

import { requireRealDataAllowed } from "../ai/models"
import { getDb, withTransaction } from "../db"
import { auditLog, documents } from "../db/schema"
import { documentStore } from "../integrations/document-store"
import { requireConsent } from "./consent"
import type { OrgContext } from "./context"
import { assertCan } from "./context"
import { detectDocumentType } from "./document-type"

// Uploaded documents. Files go to a private store under the organisation's
// prefix; nothing is publicly readable. The only way to read one is
// getDocumentUrl → /api/documents/<id>, which runs openDocument with the
// caller's session, so another organisation (or a signed-out browser) gets 404.

/** Same-origin link to a document. Useless without a session in its org. */
export function documentPath(documentId: string): string {
  return `/api/documents/${documentId}`
}

const summaryColumns = {
  id: documents.id,
  kind: documents.kind,
  fileName: documents.fileName,
  mimeType: documents.mimeType,
  status: documents.status,
  uploadedBy: documents.uploadedBy,
  createdAt: documents.createdAt,
}

function toSummary(r: {
  readonly id: string
  readonly kind: DocumentKind
  readonly fileName: string
  readonly mimeType: string
  readonly status: DocumentSummary["status"]
  readonly uploadedBy: string | null
  readonly createdAt: Date
}): DocumentSummary {
  return { ...r, url: documentPath(r.id), createdAt: r.createdAt.toISOString() }
}

/** Keeps a file name printable and short; it's shown and sent in headers. */
function cleanFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(-200)
  return cleaned || "document"
}

/**
 * Stores an uploaded bill or bank statement privately and records it.
 * The type is detected from the bytes (PDF, PNG, JPEG, WebP for bills; CSV
 * or PDF for statements), at most DOCUMENT_MAX_BYTES. Writes an audit row.
 * Throws VALIDATION (empty, too big, wrong type), CONSENT_REQUIRED,
 * PAID_AI_REQUIRED,
 * INTEGRATION (storage not configured or unavailable).
 */
export async function registerDocument(
  ctx: OrgContext,
  input: RegisterDocumentInput
): Promise<DocumentSummary> {
  assertCan(ctx, "ledger", "propose")
  const i = parseInput(registerDocumentInputSchema, input)
  await requireConsent(ctx)
  requireRealDataAllowed()
  const file = i.file
  if (file.size === 0)
    throw new ServiceError("VALIDATION", "That file is empty.")
  if (file.size > DOCUMENT_MAX_BYTES)
    throw new ServiceError(
      "VALIDATION",
      `Files can be up to ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB.`
    )
  const fileName = cleanFileName(
    i.fileName ?? (file instanceof File ? file.name : "document")
  )
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const mimeType = detectDocumentType(head, {
    fileName,
    claimedType: file.type,
  })
  const allowed: readonly string[] = DOCUMENT_TYPES[i.kind]
  if (!mimeType || !allowed.includes(mimeType))
    throw new ServiceError(
      "VALIDATION",
      i.kind === "bill"
        ? "Upload the bill as a PDF, PNG, JPEG or WebP."
        : "Upload the statement as a CSV or PDF."
    )

  const id = crypto.randomUUID()
  // Org prefix + random id: no file name in the path, nothing guessable.
  const pathname = `orgs/${ctx.orgId}/documents/${id}`
  const store = documentStore()
  try {
    await store.put(pathname, file, mimeType)
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw new ServiceError("INTEGRATION", "Couldn't store the file. Try again.")
  }
  try {
    const row = await withTransaction(async (tx) => {
      const [saved] = await tx
        .insert(documents)
        .values({
          id,
          organizationId: ctx.orgId,
          kind: i.kind,
          blobUrl: pathname,
          fileName,
          mimeType,
          uploadedBy: ctx.userId,
        })
        .returning(summaryColumns)
      if (!saved) throw new Error("documents insert returned nothing")
      await tx.insert(auditLog).values({
        organizationId: ctx.orgId,
        actorId: ctx.userId,
        action: "document.upload",
        entity: "document",
        entityId: id,
        before: null,
        after: { kind: i.kind, fileName, mimeType, size: file.size },
        source: "web",
      })
      return saved
    })
    return toSummary(row)
  } catch (error) {
    // Don't leave an orphaned file behind.
    await store.delete(pathname).catch(() => undefined)
    throw error
  }
}

async function findDocument(orgId: string, id: string) {
  const [row] = await getDb()
    .select({ ...summaryColumns, pathname: documents.blobUrl })
    .from(documents)
    .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)))
    .limit(1)
  return row ?? null
}

/** The document's record. Throws NOT_FOUND outside this organisation. */
export async function getDocument(
  ctx: OrgContext,
  id: string
): Promise<DocumentSummary> {
  assertCan(ctx, "ledger", "read")
  const row = await findDocument(ctx.orgId, parseInput(idSchema, id))
  if (!row) throw new ServiceError("NOT_FOUND", "Document not found.")
  return toSummary(row)
}

/**
 * The link to view or download a document: `/api/documents/<id>`, which
 * re-checks the session and organisation on every request (there is no
 * public or signed URL). Throws NOT_FOUND outside this organisation.
 */
export async function getDocumentUrl(
  ctx: OrgContext,
  id: string
): Promise<string> {
  return (await getDocument(ctx, id)).url
}

export interface OpenedDocument {
  readonly stream: ReadableStream<Uint8Array>
  readonly mimeType: string
  readonly fileName: string
  readonly size: number
}

/**
 * Streams a document's bytes for /api/documents/[id]. Scoped to the
 * caller's organisation. Throws NOT_FOUND (including a malformed id).
 */
export async function openDocument(
  ctx: OrgContext,
  id: string
): Promise<OpenedDocument> {
  assertCan(ctx, "ledger", "read")
  const parsed = idSchema.safeParse(id)
  const row = parsed.success ? await findDocument(ctx.orgId, parsed.data) : null
  if (!row) throw new ServiceError("NOT_FOUND", "Document not found.")
  const file = await documentStore().get(row.pathname)
  if (!file) throw new ServiceError("NOT_FOUND", "Document not found.")
  // Serve the type detected at upload, never what storage reports.
  return {
    stream: file.stream,
    mimeType: row.mimeType,
    fileName: row.fileName,
    size: file.size,
  }
}
