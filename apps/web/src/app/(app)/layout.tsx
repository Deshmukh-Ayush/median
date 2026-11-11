import { headers } from "next/headers"
import Link from "next/link"
import { Suspense } from "react"
import { ArrowLeftRightIcon, LogOutIcon, UserPlusIcon } from "lucide-react"

import { AppShell, TopBar } from "@workspace/ui/components/app-shell"
import { Button } from "@workspace/ui/components/button"
import type { CommandBarGroup } from "@workspace/ui/components/command-bar"
import { Logo } from "@workspace/ui/components/logo"
import { Toaster } from "@workspace/ui/components/sonner"
import type { SidebarSection } from "@workspace/ui/components/sidebar"

import { signOut } from "@/app/(auth)/actions"
import { AskSelectionProvider } from "@/components/ask/ask-selection"
import { AskSheet } from "@/components/ask/ask-sheet"
import { AiTierBanner } from "@/components/shell/ai-tier-banner"
import { AppCommandBar } from "@/components/shell/app-command-bar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { canOpen, navigationFor } from "@/lib/navigation"
import { ROLE_LABELS, can } from "@/lib/permissions"
import { getAuth } from "@/server/auth"

import { getOrgContextOrRedirect } from "./org-context"

/**
 * Everything behind sign-in, inside the AppShell. Signed-out visitors go to
 * /sign-in, people without an active organisation to /onboarding. Navigation
 * and the command bar only list what the user's role can open.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getOrgContextOrRedirect()
  const organizations = await getAuth().api.listOrganizations({
    headers: await headers(),
  })
  const organizationName =
    organizations.find((org) => org.id === ctx.orgId)?.name ??
    "Your organisation"

  const navigation = navigationFor(ctx.role)
  const sections: SidebarSection[] = navigation.map((section) => ({
    ...(section.label ? { label: section.label } : {}),
    items: section.items.map((item) => ({
      label: item.label,
      href: item.href,
      icon: <item.icon aria-hidden />,
    })),
  }))

  const commandGroups: CommandBarGroup[] = [
    {
      heading: "Go to",
      items: navigation.flatMap((section) =>
        section.items.map((item) => ({
          id: item.href,
          label: item.label,
          href: item.href,
          icon: <item.icon aria-hidden />,
          ...(item.keywords ? { keywords: item.keywords } : {}),
        }))
      ),
    },
    {
      heading: "Organisation",
      items: [
        ...(can(ctx.role, { resource: "invitation", action: "create" })
          ? [
              {
                id: "invite",
                label: "Invite a member",
                href: "/settings/members",
                icon: <UserPlusIcon aria-hidden />,
                keywords: ["team", "ca", "add"],
              },
            ]
          : []),
        {
          id: "switch-organisation",
          label: "Switch organisation",
          href: "/onboarding",
          icon: <ArrowLeftRightIcon aria-hidden />,
        },
      ],
    },
  ]

  return (
    <AskSelectionProvider>
      <AppShell
        sidebar={
          <AppSidebar
            sections={sections}
            header={
              <Link href="/" aria-label="Median home" className="rounded-md">
                <Logo />
              </Link>
            }
            footer={
              <div className="flex items-center gap-2 px-2 py-1">
                <Link
                  href="/onboarding"
                  className="flex min-w-0 flex-1 flex-col rounded-md hover:text-fg"
                  title="Switch organisation"
                >
                  <span className="truncate text-sm font-medium">
                    {organizationName}
                  </span>
                  <span className="text-xs text-fg-secondary">
                    {ROLE_LABELS[ctx.role]}
                  </span>
                </Link>
                <form action={signOut}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <LogOutIcon aria-hidden />
                  </Button>
                </form>
              </div>
            }
          />
        }
        topBar={
          <TopBar
            actions={
              <>
                {canOpen(ctx.role, "/ask") ? (
                  // useSearchParams: render on the client below a boundary.
                  <Suspense fallback={null}>
                    <AskSheet />
                  </Suspense>
                ) : null}
                <AppCommandBar groups={commandGroups} />
              </>
            }
          >
            <span className="truncate text-fg">{organizationName}</span>
          </TopBar>
        }
      >
        <AiTierBanner role={ctx.role} />
        {children}
        <Toaster />
      </AppShell>
    </AskSelectionProvider>
  )
}
