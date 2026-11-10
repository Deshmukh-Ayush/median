import { createAccessControl } from "better-auth/plugins/access"
import {
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access"

/**
 * Permission statements for organisations. Shared by the server config and a
 * future auth client, so this file must stay free of server-only imports.
 *
 * Placeholder permissions: revisit when the ledger features land.
 */
export const statements = {
  ...defaultStatements,
  ledger: ["read", "propose", "post", "reverse"],
  period: ["read", "lock", "unlock"],
  report: ["read", "export"],
  /** Organisation settings: GST profile, consent, integrations setup. */
  settings: ["read", "update"],
} as const

export const ac = createAccessControl(statements)

/** Full control, including members, invitations and the organisation itself. */
export const owner = ac.newRole({
  ...ownerAc.statements,
  ledger: ["read", "propose", "post", "reverse"],
  period: ["read", "lock", "unlock"],
  report: ["read", "export"],
  settings: ["read", "update"],
})

/** In-house finance team: runs the books day to day. */
export const finance = ac.newRole({
  ledger: ["read", "propose", "post", "reverse"],
  period: ["read", "lock"],
  report: ["read", "export"],
  settings: ["read", "update"],
})

/**
 * External chartered accountant: works on the books and closes months, can't
 * manage people or unlock.
 */
export const ca = ac.newRole({
  ledger: ["read", "propose", "post", "reverse"],
  period: ["read", "lock"],
  report: ["read", "export"],
  settings: ["read"],
})

/** Investor: read-only. */
export const investor = ac.newRole({
  ledger: ["read"],
  period: ["read"],
  report: ["read"],
  settings: ["read"],
})

export const roles = { owner, finance, ca, investor } as const
export type OrgRole = keyof typeof roles
