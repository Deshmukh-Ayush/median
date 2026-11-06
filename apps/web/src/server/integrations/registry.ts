import "server-only"

import type { ConnectorInfo } from "@workspace/contracts"

import type { Connector } from "./connector"
import { razorpaySettlementReportConnector } from "./razorpay-settlement-report/connector"
import {
  razorpayOAuthConnector,
  razorpayTestKeysConnector,
} from "./razorpay/connector"

// Every connector Median knows. Adding one = a folder under integrations/
// and a line here.

export const CONNECTORS: readonly Connector[] = [
  razorpayOAuthConnector,
  razorpayTestKeysConnector,
  razorpaySettlementReportConnector,
]

/**
 * Listed in the gallery without an implementation in this registry yet.
 * bank-statement imports still run through the stub in services/connectors.ts
 * until its connector lands (Day 3).
 */
export const LISTED_ONLY: readonly ConnectorInfo[] = [
  {
    provider: "bank-statement",
    displayName: "Bank statement",
    category: "banks",
    authType: "file",
    description: "CSV or PDF statements from any Indian bank.",
    availability: "available",
    accepts: ["text/csv", "application/pdf"],
    testModeOnly: false,
  },
  {
    provider: "tally-import",
    displayName: "Import from Tally",
    category: "accounting",
    authType: "file",
    description:
      "Masters, opening balances and vouchers from a Tally XML export.",
    availability: "coming_soon",
    accepts: ["application/xml", "text/xml"],
    testModeOnly: false,
  },
  {
    provider: "zoho-books-import",
    displayName: "Import from Zoho Books",
    category: "accounting",
    authType: "file",
    description: "Zoho Books CSV exports.",
    availability: "coming_soon",
    accepts: ["text/csv"],
    testModeOnly: false,
  },
  {
    provider: "stripe",
    displayName: "Stripe",
    category: "payments",
    authType: "oauth",
    description: "Payments and payouts.",
    availability: "coming_soon",
    accepts: [],
    testModeOnly: false,
  },
  {
    provider: "cashfree",
    displayName: "Cashfree",
    category: "payments",
    authType: "api_key",
    description: "Payments and settlements.",
    availability: "coming_soon",
    accepts: [],
    testModeOnly: false,
  },
  {
    provider: "shopify",
    displayName: "Shopify",
    category: "sales_channels",
    authType: "oauth",
    description: "Orders, refunds and payouts.",
    availability: "coming_soon",
    accepts: [],
    testModeOnly: false,
  },
]

export function connectorInfos(): readonly ConnectorInfo[] {
  return [...CONNECTORS.map((c) => c.info), ...LISTED_ONLY]
}

export function getConnector(provider: string): Connector | null {
  return CONNECTORS.find((c) => c.info.provider === provider) ?? null
}
