import "server-only"

import { isServiceError } from "@workspace/contracts"
import { redirect } from "next/navigation"
import { connection } from "next/server"

import { canOpen } from "@/lib/navigation"
import { requireOrgContext } from "@/server/services"
import type { OrgContext } from "@/server/services"

/**
 * The caller's organisation and role, or a redirect: to sign-in when signed
 * out, to onboarding when no organisation is active (or the active one is no
 * longer theirs). Memoised per request by requireOrgContext.
 */
export async function getOrgContextOrRedirect(): Promise<OrgContext> {
  // Session-scoped: never prerender. (requireOrgContext reads env before it
  // touches headers(), which would otherwise fail static builds.)
  await connection()
  try {
    return await requireOrgContext()
  } catch (error) {
    if (isServiceError(error)) {
      if (error.code === "UNAUTHENTICATED") redirect("/sign-in")
      if (
        error.code === "NO_ACTIVE_ORGANIZATION" ||
        error.code === "FORBIDDEN"
      ) {
        redirect("/onboarding")
      }
    }
    throw error
  }
}

/**
 * The org context for a page in the main navigation, or null when the role
 * can't open it. Hiding a link isn't enough: this guards direct URLs too.
 */
export async function getPageContext(
  href: string
): Promise<{ ctx: OrgContext; allowed: boolean }> {
  const ctx = await getOrgContextOrRedirect()
  return { ctx, allowed: canOpen(ctx.role, href) }
}
