import * as React from "react"
import { cn } from "cn"

interface SidebarItem {
  label: string
  href: string
  icon?: React.ReactNode
  /** A count to show on the right, like items waiting in the AI inbox. */
  count?: number
  disabled?: boolean
}

interface SidebarSection {
  label?: string
  items: readonly SidebarItem[]
}

function isActive(href: string, current: string | undefined): boolean {
  if (!current) return false
  if (href === "/") return current === "/"
  return current === href || current.startsWith(`${href}/`)
}

/** Primary navigation. Selected is neutral: --bg-selected, never the accent. */
function Sidebar({
  header,
  sections,
  currentHref,
  footer,
  label = "Main",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  header?: React.ReactNode
  sections: readonly SidebarSection[]
  /** The current path, used to mark the active item. */
  currentHref?: string
  footer?: React.ReactNode
  /** Accessible name of the nav landmark. */
  label?: string
}) {
  return (
    <div
      data-slot="sidebar"
      className={cn("flex h-full min-h-0 flex-col", className)}
      {...props}
    >
      {header ? (
        <div className="flex h-(--topbar-height) shrink-0 items-center px-3">
          {header}
        </div>
      ) : null}
      <nav
        aria-label={label}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-2"
      >
        {sections.map((section, index) => (
          <div key={section.label ?? index} className="flex flex-col gap-px">
            {section.label ? (
              <p className="px-2 pb-1 text-2xs font-medium text-fg-secondary">
                {section.label}
              </p>
            ) : null}
            <ul className="flex flex-col gap-px">
              {section.items.map((item) => {
                const active = isActive(item.href, currentHref)
                return (
                  <li key={item.href}>
                    <a
                      href={item.disabled ? undefined : item.href}
                      aria-current={active ? "page" : undefined}
                      aria-disabled={item.disabled || undefined}
                      data-slot="sidebar-item"
                      className="flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg active:bg-selected aria-disabled:pointer-events-none aria-disabled:text-fg-disabled aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-fg [&>svg]:size-4 [&>svg]:shrink-0"
                    >
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                      {item.count ? (
                        <span className="ml-auto text-xs text-fg-secondary tabular">
                          {item.count}
                        </span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      {footer ? (
        <div className="shrink-0 border-t border-subtle p-2">{footer}</div>
      ) : null}
    </div>
  )
}

export { Sidebar }
export type { SidebarItem, SidebarSection }
