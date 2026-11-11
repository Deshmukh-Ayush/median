"use client"

import * as React from "react"

/**
 * Records a page has in focus that the URL doesn't show (the inbox item
 * open in the detail panel), so the Ask sheet can include them in its page
 * context. Pages call useAskSelection; the sheet reads it.
 */
const AskSelectionContext = React.createContext<{
  readonly ids: readonly string[]
  readonly setIds: (ids: readonly string[]) => void
} | null>(null)

export function AskSelectionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [ids, setIds] = React.useState<readonly string[]>([])
  const value = React.useMemo(() => ({ ids, setIds }), [ids])
  return (
    <AskSelectionContext.Provider value={value}>
      {children}
    </AskSelectionContext.Provider>
  )
}

/** The ids the current page registered. */
export function useAskSelectedIds(): readonly string[] {
  return React.useContext(AskSelectionContext)?.ids ?? []
}

/** Tells the Ask sheet which record is in focus; cleared on unmount. */
export function useAskSelection(id: string | null): void {
  const setIds = React.useContext(AskSelectionContext)?.setIds
  React.useEffect(() => {
    if (!setIds) return
    setIds(id ? [id] : [])
    return () => setIds([])
  }, [id, setIds])
}
