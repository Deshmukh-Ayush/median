"use client"

import * as React from "react"

const ROW = "tr[data-row-id]"

function rowsOf(body: HTMLTableSectionElement): HTMLTableRowElement[] {
  return Array.from(body.querySelectorAll<HTMLTableRowElement>(ROW))
}

/** Moves focus to a row and makes it the single tab stop (roving tabindex). */
function focusRow(rows: HTMLTableRowElement[], next: HTMLTableRowElement) {
  for (const row of rows) row.tabIndex = row === next ? 0 : -1
  next.focus()
}

/**
 * The keyboard half of DataTable. Rows stay server-rendered; this only adds
 * j/k and arrow navigation, Home/End, and Enter to open the row's link.
 */
function DataTableBody(props: React.ComponentProps<"tbody">) {
  const { onKeyDown, ...rest } = props

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>) {
    onKeyDown?.(event)
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return
    }
    const target = event.target
    if (!(target instanceof HTMLTableRowElement) || !target.matches(ROW)) return
    const rows = rowsOf(event.currentTarget)
    const index = rows.indexOf(target)
    let next: HTMLTableRowElement | undefined
    switch (event.key) {
      case "ArrowDown":
      case "j":
        next = rows[Math.min(rows.length - 1, index + 1)]
        break
      case "ArrowUp":
      case "k":
        next = rows[Math.max(0, index - 1)]
        break
      case "Home":
        next = rows[0]
        break
      case "End":
        next = rows[rows.length - 1]
        break
      case "Enter": {
        const link = target.querySelector<HTMLElement>(
          "[data-row-link], a[href]"
        )
        if (link) {
          event.preventDefault()
          link.click()
        }
        return
      }
      default:
        return
    }
    if (next) {
      event.preventDefault()
      focusRow(rows, next)
    }
  }

  return <tbody {...rest} onKeyDown={handleKeyDown} />
}

export { DataTableBody }
