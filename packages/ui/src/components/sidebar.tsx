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

/** The props Sidebar passes to its link component. */
interface SidebarLinkProps {
  href: string
  className: string
  "aria-current": "page" | undefined
  "data-slot": string
  children: React.ReactNode
}

/** A link component, e.g. a Next.js Link wrapper, for client-side navigation. */
type SidebarLink = React.ComponentType<SidebarLinkProps>

function DefaultLink(props: SidebarLinkProps) {
  return <a {...props} />
}

const ITEM_CLASS =
  "flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg active:bg-selected aria-disabled:pointer-events-none aria-disabled:text-fg-disabled aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-fg [&>svg]:size-4 [&>svg]:shrink-0"

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
  linkComponent: LinkComponent = DefaultLink,
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
  /** Renders items with this instead of <a>, e.g. Next.js Link. */
  linkComponent?: SidebarLink
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
                const content = (
                  <>
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                    {item.count ? (
                      <span className="ml-auto tabular text-xs text-fg-secondary">
                        {item.count}
                      </span>
                    ) : null}
                  </>
                )
                return (
                  <li key={item.href}>
                    {item.disabled ? (
                      <span
                        aria-disabled
                        data-slot="sidebar-item"
                        className={ITEM_CLASS}
                      >
                        {content}
                      </span>
                    ) : (
                      <LinkComponent
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        data-slot="sidebar-item"
                        className={ITEM_CLASS}
                      >
                        {content}
                      </LinkComponent>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      {footer ? (
        <div className="shrink-0 border-t border-faint p-2">{footer}</div>
      ) : null}
    </div>
  )
}

export { Sidebar }
export type { SidebarItem, SidebarLink, SidebarLinkProps, SidebarSection }
