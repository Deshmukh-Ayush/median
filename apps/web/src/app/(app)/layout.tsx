import Link from "next/link"

import { Button } from "@workspace/ui/components/button"
import { Logo } from "@workspace/ui/components/logo"

import { signOut } from "@/app/(auth)/actions"
import { navigationFor } from "@/lib/navigation"
import { ROLE_LABELS } from "@/lib/permissions"

import { getOrgContextOrRedirect } from "./org-context"

/**
 * Everything behind sign-in. Signed-out visitors go to /sign-in, people
 * without an active organisation to /onboarding. The full AppShell replaces
 * this frame in the next slice.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getOrgContextOrRedirect()
  const sections = navigationFor(ctx.role)
  return (
    <div className="flex min-h-svh flex-col bg-app">
      <header className="flex h-12 items-center gap-4 border-b border-subtle px-4">
        <Logo />
        <nav aria-label="Main" className="flex flex-1 gap-1 overflow-x-auto">
          {sections.flatMap((section) =>
            section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-2 py-1 text-sm whitespace-nowrap text-fg-secondary hover:bg-hover hover:text-fg"
              >
                {item.label}
              </Link>
            ))
          )}
        </nav>
        <span className="text-xs text-fg-secondary">
          {ROLE_LABELS[ctx.role]}
        </span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
