import type { Metadata } from "next"
import { headers } from "next/headers"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { InviteMemberForm } from "@/components/auth/invite-member-form"
import type { RoleOption } from "@/components/auth/invite-member-form"
import {
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  can,
  isOrgRole,
} from "@/lib/permissions"
import { getAuth } from "@/server/auth"

import { getOrgContextOrRedirect } from "../../org-context"

export const metadata: Metadata = { title: "Members · Median" }

const ROLE_OPTIONS: readonly RoleOption[] = INVITABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
  description: ROLE_DESCRIPTIONS[role],
}))

function roleLabel(role: string): string {
  const first = role.split(",")[0]?.trim() ?? ""
  return isOrgRole(first) ? ROLE_LABELS[first] : first
}

export default async function MembersPage() {
  const ctx = await getOrgContextOrRedirect()
  const canInvite = can(ctx.role, { resource: "invitation", action: "create" })
  const organization = await getAuth().api.getFullOrganization({
    headers: await headers(),
  })
  const members = organization?.members ?? []
  const pending = (organization?.invitations ?? []).filter(
    (invitation) => invitation.status === "pending"
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader
        title="Members"
        description="Who can see and work on your books."
      />

      <section
        aria-labelledby="members-list"
        className="overflow-hidden rounded-lg border border-default bg-surface"
      >
        <h2 id="members-list" className="sr-only">
          Current members
        </h2>
        <ul className="divide-y divide-subtle">
          {members.map((member) => (
            <li key={member.id} className="flex h-12 items-center gap-3 px-4">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {member.user.name}
                  {member.userId === ctx.userId ? (
                    <span className="font-normal text-fg-secondary">
                      {" "}
                      (you)
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs text-fg-secondary">
                  {member.user.email}
                </span>
              </span>
              <StatusChip>{roleLabel(member.role)}</StatusChip>
            </li>
          ))}
          {pending.map((invitation) => (
            <li
              key={invitation.id}
              className="flex h-12 items-center gap-3 px-4"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{invitation.email}</span>
                <span className="text-xs text-fg-secondary">Invited</span>
              </span>
              <StatusChip tone="warning">
                Pending · {roleLabel(invitation.role)}
              </StatusChip>
            </li>
          ))}
        </ul>
      </section>

      {canInvite ? (
        <section
          aria-labelledby="invite"
          className="flex flex-col gap-4 rounded-lg border border-default bg-surface p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 id="invite" className="text-base font-semibold">
              Invite someone
            </h2>
            <p className="text-sm text-fg-secondary">
              Your finance team, your CA or an investor. You can change their
              role later.
            </p>
          </div>
          <InviteMemberForm roles={ROLE_OPTIONS} />
        </section>
      ) : (
        <p className="text-sm text-fg-secondary">
          Only owners can invite people. Ask an owner of this organisation.
        </p>
      )}
    </div>
  )
}
