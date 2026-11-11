import * as React from "react"
import { cn } from "cn"

/**
 * The app frame: a 232px sidebar on --bg-sidebar and the content area on
 * --bg-app, with a 48px top bar.
 */
function AppShell({
  sidebar,
  topBar,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  sidebar: React.ReactNode
  topBar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "grid h-svh grid-cols-[var(--sidebar-width)_minmax(0,1fr)] bg-app text-fg",
        className
      )}
      {...props}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2"
      >
        Skip to content
      </a>
      <aside className="min-h-0 border-r border-faint bg-sidebar">
        {sidebar}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        {topBar}
        <main
          id="main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-auto outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

/** The 48px bar above the content: breadcrumbs or title on the left, actions on the right. */
function TopBar({
  className,
  children,
  actions,
  ...props
}: React.ComponentProps<"header"> & { actions?: React.ReactNode }) {
  return (
    <header
      data-slot="top-bar"
      className={cn(
        "flex h-(--topbar-height) shrink-0 items-center gap-3 border-b border-faint px-4",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-secondary">
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

/** A page title in Inter Display, with an optional description and actions. */
function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex items-end justify-between gap-4", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-xl font-semibold text-fg">{title}</h1>
        {description ? (
          <p className="text-sm text-fg-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

export { AppShell, PageHeader, TopBar }
