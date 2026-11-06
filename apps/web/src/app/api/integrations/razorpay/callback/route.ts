import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"

import {
  completeRazorpayOAuthInputSchema,
  isServiceError,
} from "@workspace/contracts"

import { safeRedirect } from "@/lib/safe-redirect"
import { completeRazorpayOAuth, requireOrgContext } from "@/server/services"

const INTEGRATIONS = "/settings/integrations"

/** Where each failure goes. Fixed codes only: no provider text is echoed. */
const ON_ERROR: Record<string, string> = {
  NO_ACTIVE_ORGANIZATION: "/onboarding",
  FORBIDDEN: "/onboarding",
  CONSENT_REQUIRED: `${INTEGRATIONS}/consent?next=${encodeURIComponent(INTEGRATIONS)}`,
  INTEGRATION: `${INTEGRATIONS}?status=declined`,
  VALIDATION: `${INTEGRATIONS}?status=expired`,
}

/**
 * Razorpay sends the browser here after its approval screen
 * (RAZORPAY_OAUTH_CALLBACK_PATH).
 */
export async function GET(request: NextRequest): Promise<never> {
  const params = completeRazorpayOAuthInputSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  )
  if (!params.success) redirect(`${INTEGRATIONS}?status=expired`)
  let returnTo: string
  try {
    const ctx = await requireOrgContext()
    const result = await completeRazorpayOAuth(ctx, params.data)
    returnTo = result.returnTo
  } catch (error) {
    if (!isServiceError(error)) throw error
    if (error.code === "UNAUTHENTICATED") {
      const here = `${request.nextUrl.pathname}${request.nextUrl.search}`
      redirect(`/sign-in?redirectTo=${encodeURIComponent(here)}`)
    }
    redirect(ON_ERROR[error.code] ?? `${INTEGRATIONS}?status=failed`)
  }
  const target = safeRedirect(returnTo, INTEGRATIONS)
  const separator = target.includes("?") ? "&" : "?"
  redirect(`${target}${separator}status=connected`)
}
