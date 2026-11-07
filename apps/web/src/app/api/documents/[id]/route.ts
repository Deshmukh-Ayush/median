import { ServiceError } from "@workspace/contracts"

import { openDocument, requireOrgContext } from "@/server/services"

/**
 * Serves an uploaded document to a signed-in member of its organisation.
 * Files live in a private store; this route is the only way to read them.
 * Another organisation's document, or a malformed id, is a plain 404.
 */
export async function GET(
  _request: Request,
  // Typed by hand: CI lints before `next typegen` creates RouteContext.
  ctx: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  const { id } = await ctx.params
  try {
    const org = await requireOrgContext()
    const file = await openDocument(org, id)
    // ASCII fallback plus the UTF-8 name (RFC 6266).
    const ascii = file.fileName.replace(/[^\x20-\x7e]|["\\]/g, "_")
    return new Response(file.stream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Never a page that can run script. Chrome won't render a PDF under
        // `sandbox`, so PDFs only get framing limited to our own pages.
        "Content-Security-Policy":
          file.mimeType === "application/pdf"
            ? "frame-ancestors 'self'"
            : "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    })
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error
    const status =
      error.code === "UNAUTHENTICATED" ||
      error.code === "NO_ACTIVE_ORGANIZATION"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : 502
    return Response.json({ error: error.message }, { status })
  }
}
