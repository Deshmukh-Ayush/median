"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Sidebar } from "@workspace/ui/components/sidebar"
import type {
  SidebarLinkProps,
  SidebarSection,
} from "@workspace/ui/components/sidebar"

function NavLink({ href, children, ...rest }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      className={rest.className}
      aria-current={rest["aria-current"]}
      data-slot={rest["data-slot"]}
    >
      {children}
    </Link>
  )
}

/**
 * The app sidebar. The sections (already filtered for the user's role) come
 * from the server; this only marks the current page and uses Next's Link
 * so navigation is client-side and prefetched.
 */
export function AppSidebar({
  sections,
  header,
  footer,
}: {
  sections: readonly SidebarSection[]
  header: React.ReactNode
  footer: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <Sidebar
      header={header}
      sections={sections}
      currentHref={pathname}
      footer={footer}
      linkComponent={NavLink}
    />
  )
}
