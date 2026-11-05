import { roles } from "@/server/auth/permissions"
import type { OrgRole, statements } from "@/server/auth/permissions"

type Statements = typeof statements

/** One permission: a resource and an action on it, e.g. ledger:propose. */
export type Permission = {
  [R in keyof Statements]: { resource: R; action: Statements[R][number] }
}[keyof Statements]

/** True if the role grants the permission. Mirrors the server's assertCan. */
export function can(role: OrgRole, permission: Permission): boolean {
  return roles[role].authorize({
    [permission.resource]: [permission.action],
  }).success
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  finance: "Finance",
  ca: "Chartered accountant",
  investor: "Investor",
}

/** Roles an owner can invite. Ownership isn't handed out by invitation. */
export const INVITABLE_ROLES = ["finance", "ca", "investor"] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export const ROLE_DESCRIPTIONS: Record<InvitableRole, string> = {
  finance: "Runs the books day to day: approves, posts and reverses entries.",
  ca: "Works on the books and exports reports. Can't manage people.",
  investor: "Read-only access to reports and the ledger.",
}

export function isOrgRole(value: string): value is OrgRole {
  return Object.hasOwn(roles, value)
}
