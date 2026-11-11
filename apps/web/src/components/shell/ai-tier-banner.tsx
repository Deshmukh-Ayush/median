import Link from "next/link"
import { TriangleAlertIcon } from "lucide-react"

import type { OrgRole } from "@/server/auth/permissions"
import { getAiProviderStatus } from "@/server/ai/models"

/**
 * Owners only, production only: the AI provider is on its free tier, which
 * may use what it's sent for training. Real customer data must not go there.
 */
export function AiTierBanner({ role }: { role: OrgRole }) {
  if (role !== "owner") return null
  const status = getAiProviderStatus()
  if (!status.freeTierInProduction) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-default bg-danger-soft px-6 py-2 text-sm text-danger"
    >
      <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">
        AI is running on {status.provider}&apos;s free tier. Don&apos;t upload
        real bills or statements until a paid plan is set up.
      </span>
      <Link href="/settings/ai" className="font-medium underline">
        Details
      </Link>
    </div>
  )
}
