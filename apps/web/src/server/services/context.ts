import "server-only"

import { ServiceError } from "@workspace/contracts"
import { and, eq } from "drizzle-orm"
import { headers } from "next/headers"
import { cache } from "react"

import { getAuth } from "../auth"
import { roles } from "../auth/permissions"
import type { OrgRole, statements } from "../auth/permissions"
import { getDb } from "../db"
import { member } from "../db/schema"

/**
 * Who is calling a service, and for which organisation. Every service takes
 * this as its first argument; every query is scoped by `orgId`.
 */
export interface OrgContext {
  readonly orgId: string
  readonly userId: string
  readonly role: OrgRole
}

function isOrgRole(value: string): value is OrgRole {
  return Object.hasOwn(roles, value)
}

/**
 * Resolves the signed-in user's active organisation and role from the request
 * cookies. Throws ServiceError("UNAUTHENTICATED" | "NO_ACTIVE_ORGANIZATION").
 * Memoised per request.
 */
export const requireOrgContext = cache(async (): Promise<OrgContext> => {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) throw new ServiceError("UNAUTHENTICATED", "Please sign in.")

  const orgId = session.session.activeOrganizationId
  if (!orgId) {
    throw new ServiceError(
      "NO_ACTIVE_ORGANIZATION",
      "Choose an organisation first."
    )
  }

  const [membership] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, orgId), eq(member.userId, session.user.id))
    )
    .limit(1)
  if (!membership) {
    throw new ServiceError(
      "FORBIDDEN",
      "You are not a member of this organisation."
    )
  }

  // Better Auth stores multiple roles comma-separated; Median uses one.
  const role = membership.role
    .split(",")
    .map((r) => r.trim())
    .find(isOrgRole)
  if (!role) {
    throw new ServiceError("FORBIDDEN", "Your role has no access to the books.")
  }

  return { orgId, userId: session.user.id, role }
})

type Statements = typeof statements
type Resource = Exclude<
  keyof Statements,
  "organization" | "member" | "invitation" | "team" | "ac"
>

/** Throws ServiceError("FORBIDDEN") unless the caller's role allows `action`. */
export function assertCan<R extends Resource>(
  ctx: OrgContext,
  resource: R,
  action: Statements[R][number]
): void {
  const result = roles[ctx.role].authorize({ [resource]: [action] })
  if (!result.success) {
    throw new ServiceError(
      "FORBIDDEN",
      `Your role (${ctx.role}) can't ${action} ${resource}.`
    )
  }
}
