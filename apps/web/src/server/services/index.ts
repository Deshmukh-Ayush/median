// Median service layer: the contract between the backend and the app.
// Every function takes an OrgContext first (get it with requireOrgContext())
// and throws ServiceError on expected failures.

export type { OrgContext } from "./context"
export { assertCan, requireOrgContext } from "./context"
// Shared types and schemas live in @workspace/contracts; re-exported here so
// existing imports from "@/server/services" keep working.
export * from "@workspace/contracts"

export * from "./accounts"
export * from "./audit"
export * from "./bank"
export * from "./connectors"
export * from "./consent"
export * from "./credit-notes"
export * from "./dashboard"
export * from "./extraction"
export * from "./gst-rates"
export * from "./gst"
export * from "./gst-profile"
export * from "./inbox"
export * from "./invoices"
export type { ManualEntryInput, PostedEntryResult } from "./ledger"
export { postManualEntry, reverseEntry } from "./ledger"
export * from "./parties"
export * from "./periods"
export * from "./razorpay"
export * from "./reports"
export * from "./tally"
