import { LockIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { PageHeader } from "@workspace/ui/components/app-shell"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { ROLE_LABELS } from "@/lib/permissions"
import type { OrgRole } from "@/server/auth/permissions"

/** A page that isn't built yet, or that the user's role can't open. */
export function PlaceholderPage({
  title,
  description,
  icon: Icon,
  emptyTitle,
  emptyDescription,
  allowed,
  role,
}: {
  title: string
  description: string
  icon: LucideIcon
  emptyTitle: string
  emptyDescription: string
  allowed: boolean
  role: OrgRole
}) {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={title}
        description={description}
        actions={allowed ? <StatusChip>Coming soon</StatusChip> : null}
      />
      <div className="rounded-lg border border-default bg-surface">
        {allowed ? (
          <EmptyState
            icon={<Icon />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <EmptyState
            icon={<LockIcon />}
            title="You don't have access to this"
            description={`Your role (${ROLE_LABELS[role]}) can't open ${title}. Ask an owner if you need it.`}
          />
        )}
      </div>
    </div>
  )
}
