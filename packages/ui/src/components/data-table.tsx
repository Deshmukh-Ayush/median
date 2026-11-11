import * as React from "react"
import { cn } from "cn"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import { DataTableBody } from "@workspace/ui/components/data-table-body"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

interface DataTableColumn<Row> {
  id: string
  header: React.ReactNode
  cell: (row: Row) => React.ReactNode
  /** Right-aligned, tabular figures. Use for every amount and count. */
  numeric?: boolean
  /** e.g. "w-40". Applied to the header cell. */
  className?: string
}

interface DataTableProps<Row> {
  /** Accessible name, e.g. "Invoices". */
  label: string
  columns: readonly DataTableColumn<Row>[]
  rows: readonly Row[]
  getRowId: (row: Row) => string
  selectedRowId?: string
  /** Shows skeleton rows instead of data (use as a Suspense fallback too). */
  loading?: boolean
  skeletonRows?: number
  /** Shown instead of rows when loading failed. */
  error?: React.ReactNode
  /** Shown when there are no rows. Usually an EmptyState. */
  empty?: React.ReactNode
  /** Cursor pagination, usually a DataTablePagination. */
  pagination?: React.ReactNode
  /** Caps the height so the header sticks while the body scrolls. */
  maxHeight?: string
  className?: string
}

/**
 * A dense table for lists of entries, invoices or bills. Server-rendered; the
 * keyboard handling (j/k, arrows, Home/End, Enter) is a small client body.
 * Put `data-row-link` on the element Enter should open, or the first link in
 * the row is used.
 */
function DataTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  selectedRowId,
  loading = false,
  skeletonRows = 6,
  error,
  empty,
  pagination,
  maxHeight,
  className,
}: DataTableProps<Row>) {
  const colSpan = columns.length
  let body: React.ReactNode
  if (loading) {
    body = Array.from({ length: skeletonRows }, (_, index) => (
      <TableRow key={index} aria-hidden className="hover:bg-transparent">
        {columns.map((column) => (
          <TableCell key={column.id} numeric={column.numeric}>
            <Skeleton
              className={cn(
                "h-3 max-w-full",
                column.numeric ? "ml-auto w-16" : index % 2 ? "w-28" : "w-40"
              )}
            />
          </TableCell>
        ))}
      </TableRow>
    ))
  } else if (error) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="h-auto py-8">
          <div
            role="alert"
            className="flex items-center justify-center gap-2 text-sm text-danger"
          >
            <TriangleAlertIcon aria-hidden className="size-4" />
            {error}
          </div>
        </TableCell>
      </TableRow>
    )
  } else if (rows.length === 0) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="h-auto whitespace-normal">
          {empty ?? (
            <p className="py-8 text-center text-sm text-fg-secondary">
              Nothing here yet.
            </p>
          )}
        </TableCell>
      </TableRow>
    )
  } else {
    body = rows.map((row, index) => {
      const id = getRowId(row)
      return (
        <TableRow
          key={id}
          data-row-id={id}
          tabIndex={index === 0 ? 0 : -1}
          aria-selected={
            selectedRowId === undefined ? undefined : selectedRowId === id
          }
          className="cursor-default focus-visible:outline-offset-[-2px]"
        >
          {columns.map((column) => (
            <TableCell key={column.id} numeric={column.numeric}>
              {column.cell(row)}
            </TableCell>
          ))}
        </TableRow>
      )
    })
  }

  return (
    <div
      data-slot="data-table"
      className={cn(
        "overflow-hidden rounded-lg border border-default bg-surface",
        className
      )}
    >
      <Table
        aria-label={label}
        aria-busy={loading || undefined}
        containerStyle={maxHeight ? { maxHeight } : undefined}
      >
        <TableHeader sticky>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.id}
                scope="col"
                numeric={column.numeric}
                className={column.className}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <DataTableBody>{body}</DataTableBody>
      </Table>
      {pagination}
    </div>
  )
}

/**
 * Cursor pagination: previous/next are links carrying the cursor in the URL,
 * so pages are server-rendered and shareable.
 */
function DataTablePagination({
  summary,
  previousHref,
  nextHref,
  className,
}: {
  /** e.g. "Showing 25 of 1,204". */
  summary?: React.ReactNode
  previousHref?: string
  nextHref?: string
  className?: string
}) {
  const link = (
    href: string | undefined,
    label: string,
    icon: React.ReactNode,
    iconEnd: boolean
  ) =>
    href ? (
      <a
        href={href}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        {iconEnd ? null : icon}
        {label}
        {iconEnd ? icon : null}
      </a>
    ) : (
      <span
        aria-disabled
        className={cn(
          buttonVariants({ variant: "secondary", size: "sm" }),
          "border-faint text-fg-disabled"
        )}
      >
        {iconEnd ? null : icon}
        {label}
        {iconEnd ? icon : null}
      </span>
    )
  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex h-11 items-center justify-between gap-3 border-t border-faint px-3",
        className
      )}
    >
      <p className="text-xs text-fg-secondary">{summary}</p>
      <div className="flex items-center gap-1.5">
        {link(previousHref, "Previous", <ChevronLeftIcon aria-hidden />, false)}
        {link(nextHref, "Next", <ChevronRightIcon aria-hidden />, true)}
      </div>
    </nav>
  )
}

export { DataTable, DataTablePagination }
export type { DataTableColumn, DataTableProps }
