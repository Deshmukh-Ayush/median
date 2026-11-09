import Link from "next/link"
import { cn } from "cn"

export interface ViewTab {
  readonly label: string
  readonly href: string
  readonly active: boolean
}

/** Tabs as plain links: each view is a URL, rendered on the server. */
export function ViewTabs({
  label,
  tabs,
}: {
  label: string
  tabs: readonly ViewTab[]
}) {
  return (
    <nav aria-label={label} className="flex gap-1 border-b border-default">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm text-fg-secondary transition-colors hover:text-fg",
            tab.active
              ? "border-foreground font-medium text-fg"
              : "border-transparent"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
