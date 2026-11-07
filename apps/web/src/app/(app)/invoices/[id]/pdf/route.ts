import { headers } from "next/headers"

import { idSchema, isServiceError } from "@workspace/contracts"

import { getAuth } from "@/server/auth"
import { getGstProfile, getInvoice, requireOrgContext } from "@/server/services"

import { invoiceDocument } from "@/server/pdf/invoice-document"

/**
 * The invoice as a PDF, rendered on the server with @react-pdf/renderer
 * (loaded with import(), never sent to the browser).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    return new Response("Not found", { status: 404 })
  }

  let ctx
  try {
    ctx = await requireOrgContext()
  } catch (error) {
    if (isServiceError(error)) {
      return new Response("Sign in to download this invoice.", { status: 401 })
    }
    throw error
  }

  const [invoice, profile, organization] = await Promise.all([
    getInvoice(ctx, id),
    getGstProfile(ctx),
    getAuth().api.getFullOrganization({ headers: await headers() }),
  ])
  if (!invoice) return new Response("Not found", { status: 404 })

  const pdf = await import("@react-pdf/renderer")
  const buffer = await pdf.renderToBuffer(
    invoiceDocument({
      pdf,
      invoice,
      supplier: {
        name: profile.legalName ?? organization?.name ?? "Your business",
        gstin: profile.gstin,
        stateCode: profile.stateCode,
      },
    })
  )
  // Invoice numbers contain slashes: INV/2026-27/0042 → INV-2026-27-0042.pdf
  const fileName = `${invoice.number.replace(/[^\w.-]+/g, "-")}.pdf`
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
