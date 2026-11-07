import { and, eq } from "drizzle-orm"
import { afterEach, expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { auditLog, documents } from "../src/server/db/schema"
import {
  documentStore,
  setDocumentStoreForTests,
} from "../src/server/integrations/document-store"
import type { DocumentStore } from "../src/server/integrations/document-store"
import {
  getDocumentUrl,
  openDocument,
  registerDocument,
} from "../src/server/services/documents"
import { devOrg } from "./setup"

/** In-memory stand-in for the private Vercel Blob store. */
function memoryStore(): DocumentStore & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>()
  return {
    files,
    put(pathname, body, contentType) {
      if (files.has(pathname)) throw new Error("exists")
      files.set(pathname, new Blob([body], { type: contentType }))
      return Promise.resolve({ pathname })
    },
    get(pathname) {
      const f = files.get(pathname)
      return Promise.resolve(
        f ? { stream: f.stream(), contentType: f.type, size: f.size } : null
      )
    },
    delete(pathname) {
      files.delete(pathname)
      return Promise.resolve()
    },
  }
}

afterEach(() => setDocumentStoreForTests(null))

const pdf = () =>
  new File(["%PDF-1.7\n% synthetic test bill\n"], "aws-nov.pdf", {
    type: "application/pdf",
  })

it("documents are private and org-scoped", async () => {
  const ctx = await devOrg()
  const real = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  const mem = memoryStore()
  if (!real) setDocumentStoreForTests(mem)
  console.log(
    real ? "using the real private Blob store" : "using an in-memory store"
  )

  const doc = await registerDocument(ctx, { kind: "bill", file: pdf() })
  console.log("registered", doc)
  expect(doc).toMatchObject({
    kind: "bill",
    fileName: "aws-nov.pdf",
    mimeType: "application/pdf",
    status: "uploaded",
    url: `/api/documents/${doc.id}`,
  })
  expect(await getDocumentUrl(ctx, doc.id)).toBe(`/api/documents/${doc.id}`)

  const [row] = await getDb()
    .select({ pathname: documents.blobUrl })
    .from(documents)
    .where(
      and(eq(documents.organizationId, ctx.orgId), eq(documents.id, doc.id))
    )
  expect(row?.pathname).toBe(`orgs/${ctx.orgId}/documents/${doc.id}`)
  const [audit] = await getDb()
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(
      and(eq(auditLog.organizationId, ctx.orgId), eq(auditLog.entityId, doc.id))
    )
  expect(audit?.action).toBe("document.upload")

  // The caller's org reads it; another org can't even see it exists.
  const opened = await openDocument(ctx, doc.id)
  expect(await new Response(opened.stream).text()).toContain("%PDF-1.7")
  const stranger = { ...ctx, orgId: "some-other-org" }
  await expect(getDocumentUrl(stranger, doc.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  await expect(openDocument(stranger, doc.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  })
  await expect(openDocument(ctx, "not-a-uuid")).rejects.toMatchObject({
    code: "NOT_FOUND",
  })

  // Type comes from the bytes; HTML dressed up as a PDF is refused.
  await expect(
    registerDocument(ctx, {
      kind: "bill",
      file: new File(["<html><script>alert(1)</script>"], "bill.pdf", {
        type: "application/pdf",
      }),
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  await expect(
    registerDocument(ctx, {
      kind: "bank_statement",
      file: new File(["\x89PNG\r\n\x1a\n"], "s.png"),
    })
  ).rejects.toMatchObject({ code: "VALIDATION" })
  const csv = await registerDocument(ctx, {
    kind: "bank_statement",
    file: new File(
      ["Date,Narration,Amount\n01/11/2026,NEFT,100.00\n"],
      "hdfc.csv"
    ),
  })
  expect(csv.mimeType).toBe("text/csv")

  if (real) {
    // The raw private blob is not readable without the store token.
    const { get } = await import("@vercel/blob")
    const blob = await get(row?.pathname ?? "", { access: "private" })
    expect(blob?.statusCode).toBe(200)
    const anonymous = await fetch(blob?.blob.url ?? "")
    console.log("anonymous fetch of the blob URL:", anonymous.status)
    expect(anonymous.ok).toBe(false)
    await documentStore().delete(row?.pathname ?? "")
  } else {
    expect(mem.files.size).toBe(2)
  }
})
