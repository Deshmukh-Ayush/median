import { ServiceError } from "@workspace/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const services = vi.hoisted(() => ({
  requireOrgContext: vi.fn(),
  openDocument: vi.fn(),
}))
vi.mock("@/server/services", () => services)

const { GET } = await import("./route")

const call = (id: string) =>
  GET(new Request(`http://x/api/documents/${id}`), {
    params: Promise.resolve({ id }),
  })
const org = { orgId: "org_1", userId: "u1", role: "finance" }

beforeEach(() => {
  services.requireOrgContext.mockReset().mockResolvedValue(org)
  services.openDocument.mockReset()
})

describe("GET /api/documents/[id]", () => {
  it("401s without a session and never touches storage", async () => {
    services.requireOrgContext.mockRejectedValue(
      new ServiceError("UNAUTHENTICATED", "Please sign in.")
    )
    const res = await call("doc_1")
    expect(res.status).toBe(401)
    expect(services.openDocument).not.toHaveBeenCalled()
  })

  it("opens the document in the caller's org only, and 404s otherwise", async () => {
    services.openDocument.mockRejectedValue(
      new ServiceError("NOT_FOUND", "Document not found.")
    )
    const res = await call("someone-elses")
    expect(res.status).toBe(404)
    expect(services.openDocument).toHaveBeenCalledWith(org, "someone-elses")
  })

  it("streams the file privately with safe headers", async () => {
    services.openDocument.mockResolvedValue({
      stream: new Blob(["%PDF-1.7"]).stream(),
      mimeType: "application/pdf",
      fileName: 'AWS "Nov" बिल.pdf',
      size: 8,
    })
    const res = await call("doc_1")
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("%PDF-1.7")
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/pdf",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="AWS _Nov_ ___.pdf"; filename*=UTF-8''AWS%20%22Nov%22%20%E0%A4%AC%E0%A4%BF%E0%A4%B2.pdf`,
    })
  })

  it("sandboxes anything that isn't a PDF", async () => {
    services.openDocument.mockResolvedValue({
      stream: new Blob(["a,b"]).stream(),
      mimeType: "text/csv",
      fileName: "s.csv",
      size: 3,
    })
    const res = await call("doc_2")
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox"
    )
  })
})
