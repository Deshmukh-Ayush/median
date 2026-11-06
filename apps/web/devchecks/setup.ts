import { eq } from "drizzle-orm"
import { getDb } from "../src/server/db"
import { consents, member, organization, user } from "../src/server/db/schema"
import { seedOrganization } from "../src/server/services/organizations"
import type { OrgContext } from "../src/server/services/context"
import { CURRENT_CONSENT_VERSION } from "@workspace/contracts"

export const DEV_ORG = "backend-devcheck-org"
export const DEV_USER = "backend-devcheck-user"

/** A dedicated dev org for backend checks, with consent and seeded accounts. */
export async function devOrg(): Promise<OrgContext> {
  const db = getDb()
  const [u] = await db.select().from(user).where(eq(user.id, DEV_USER))
  if (!u) {
    await db
      .insert(user)
      .values({
        id: DEV_USER,
        name: "Backend dev check",
        email: "backend-devcheck@example.invalid",
        emailVerified: true,
      })
  }
  const [o] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, DEV_ORG))
  if (!o) {
    await db
      .insert(organization)
      .values({
        id: DEV_ORG,
        name: "Backend dev checks",
        slug: "backend-devcheck",
        createdAt: new Date(),
      })
    await db
      .insert(member)
      .values({
        id: "backend-devcheck-member",
        organizationId: DEV_ORG,
        userId: DEV_USER,
        role: "owner",
        createdAt: new Date(),
      })
    await seedOrganization({
      orgId: DEV_ORG,
      industry: "saas",
      actorId: DEV_USER,
    })
    await db
      .insert(consents)
      .values({
        organizationId: DEV_ORG,
        userId: DEV_USER,
        consentVersion: CURRENT_CONSENT_VERSION,
      })
      .onConflictDoNothing()
  }
  return { orgId: DEV_ORG, userId: DEV_USER, role: "owner" }
}
