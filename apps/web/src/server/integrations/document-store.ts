import "server-only"

import { ServiceError } from "@workspace/contracts"
import { del, get, list, put } from "@vercel/blob"

// Where uploaded documents (bills, statements) live: a PRIVATE Vercel Blob
// store. Private blobs can't be fetched by URL without the store's token, so
// files are only ever served through /api/documents/[id], which checks the
// session and organisation on every request. Never use access: "public".

export interface StoredFile {
  readonly stream: ReadableStream<Uint8Array>
  readonly contentType: string
  readonly size: number
}

export interface DocumentStore {
  put(
    pathname: string,
    body: Blob,
    contentType: string
  ): Promise<{ readonly pathname: string }>
  get(pathname: string): Promise<StoredFile | null>
  delete(pathname: string): Promise<void>
  /** Deletes every file whose path starts with `prefix`; returns how many. */
  deletePrefix(prefix: string): Promise<number>
}

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN
  if (!value)
    throw new ServiceError(
      "INTEGRATION",
      "Document storage isn't set up (BLOB_READ_WRITE_TOKEN)."
    )
  return value
}

const vercelBlobStore: DocumentStore = {
  async put(pathname, body, contentType) {
    const result = await put(pathname, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: token(),
    })
    return { pathname: result.pathname }
  },
  async get(pathname) {
    const result = await get(pathname, {
      access: "private",
      useCache: false,
      token: token(),
    })
    if (result?.statusCode !== 200) return null
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      size: result.blob.size,
    }
  },
  async delete(pathname) {
    await del(pathname, { token: token() })
  },
  async deletePrefix(prefix) {
    let deleted = 0
    let cursor: string | undefined
    do {
      const page = await list({
        prefix,
        limit: 1000,
        token: token(),
        ...(cursor ? { cursor } : {}),
      })
      if (page.blobs.length > 0) {
        await del(
          page.blobs.map((b) => b.url),
          { token: token() }
        )
        deleted += page.blobs.length
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return deleted
  },
}

let override: DocumentStore | null = null

/** The private document store (Vercel Blob), or a test double. */
export function documentStore(): DocumentStore {
  return override ?? vercelBlobStore
}

/** Tests and dev checks: swap the store; pass null to restore it. */
export function setDocumentStoreForTests(store: DocumentStore | null): void {
  override = store
}
