"use client"

import * as React from "react"
import { cn } from "cn"
import { SearchIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@workspace/ui/components/command"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"

interface CommandBarItem {
  id: string
  label: string
  /** Where the item goes. Items without href call onSelect. */
  href?: string
  icon?: React.ReactNode
  /** Keys to show, e.g. ["G", "I"]. */
  shortcut?: readonly string[]
  /** Extra search terms: "receivables" for "Owed to you". */
  keywords?: readonly string[]
  disabled?: boolean
}

interface CommandBarGroup {
  heading: string
  items: readonly CommandBarItem[]
}

const subscribe = () => () => {}
function useIsMac(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false
  )
}

/**
 * Ctrl/⌘+K from anywhere opens a searchable list of pages and actions.
 * Pass `onNavigate` (e.g. Next's router.push) for client-side navigation;
 * without it, items with href do a normal page load.
 */
function CommandBar({
  groups,
  onNavigate,
  onSelect,
  placeholder = "Search or jump to…",
  className,
}: {
  groups: readonly CommandBarGroup[]
  onNavigate?: (href: string) => void
  onSelect?: (item: CommandBarItem) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const isMac = useIsMac()
  const mod = isMac ? "⌘" : "Ctrl"

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // One bar per page: if another CommandBar already handled it, skip.
      if (event.defaultPrevented || event.key.toLowerCase() !== "k") return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return
      }
      event.preventDefault()
      setOpen((current) => !current)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  function run(item: CommandBarItem) {
    setOpen(false)
    if (item.href) {
      if (onNavigate) onNavigate(item.href)
      else window.location.assign(item.href)
    }
    onSelect?.(item)
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className={cn(
          "w-60 justify-start gap-2 font-normal text-fg-secondary",
          className
        )}
      >
        <SearchIcon aria-hidden />
        <span className="flex-1 text-left">{placeholder}</span>
        <KbdGroup>
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command bar"
        description="Search pages and actions"
        className="max-w-[min(560px,calc(100%-2rem))]! sm:max-w-[560px]"
      >
        <Command loop>
          <CommandInput placeholder={placeholder} />
          <CommandList className="p-1">
            <CommandEmpty className="py-8 text-center text-sm text-fg-secondary">
              No matches. Try a page name like “Invoices”.
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.id}`}
                    {...(item.keywords ? { keywords: [...item.keywords] } : {})}
                    disabled={item.disabled ?? false}
                    onSelect={() => run(item)}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                    {item.shortcut ? (
                      <CommandShortcut>
                        <KbdGroup>
                          {item.shortcut.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex h-9 items-center gap-3 border-t border-faint px-3 text-2xs text-fg-secondary">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Enter</Kbd> to open
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Esc</Kbd> to close
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  )
}

export { CommandBar }
export type { CommandBarGroup, CommandBarItem }
