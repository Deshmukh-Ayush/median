import Link from "next/link"

/**
 * Next.js Link with the plain props design-system components pass to their
 * `linkComponent` (Sidebar, StatCard): client-side, prefetched navigation.
 */
export function AppLink({
  href,
  className,
  children,
  "aria-current": ariaCurrent,
  "data-slot": dataSlot,
}: {
  href: string
  className?: string | undefined
  children: React.ReactNode
  "aria-current"?: "page" | undefined
  "data-slot"?: string | undefined
}) {
  return (
    <Link
      href={href}
      {...(className === undefined ? {} : { className })}
      {...(ariaCurrent === undefined ? {} : { "aria-current": ariaCurrent })}
      {...(dataSlot === undefined ? {} : { "data-slot": dataSlot })}
    >
      {children}
    </Link>
  )
}
