import "server-only"

import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { organization } from "better-auth/plugins"

import { getDb } from "../db"
import * as schema from "../db/schema"
import { getServerEnv } from "../env"
import {
  industryFromMetadata,
  seedOrganization,
} from "../services/organizations"
import { ac, roles } from "./permissions"

function createAuth() {
  const env = getServerEnv()
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        // Books must be kept: an organisation with a ledger can't be deleted.
        disableOrganizationDeletion: true,
        organizationHooks: {
          // Seed the chart of accounts from metadata.industry (default SaaS).
          afterCreateOrganization: async ({ organization, user }) => {
            await seedOrganization({
              orgId: organization.id,
              industry: industryFromMetadata(organization.metadata),
              actorId: user.id,
            })
          },
        },
      }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let auth: Auth | undefined

/** Lazily-created Better Auth instance, so builds don't need secrets. */
export function getAuth(): Auth {
  auth ??= createAuth()
  return auth
}
