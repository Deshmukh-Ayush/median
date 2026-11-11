import {
  BookOpenIcon,
  FileTextIcon,
  HomeIcon,
  InboxIcon,
  LandmarkIcon,
  PercentIcon,
  PieChartIcon,
  ReceiptIcon,
  SettingsIcon,
  TrendingUpIcon,
  UsersIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { OrgRole } from "@/server/auth/permissions"

import { can } from "./permissions"
import type { Permission } from "./permissions"

export interface NavItem {
  readonly label: string
  readonly href: string
  readonly icon: LucideIcon
  /** Hidden unless the role has this permission. */
  readonly requires?: Permission
  /** Extra search terms for the command bar. */
  readonly keywords?: readonly string[]
}

export interface NavSection {
  readonly label?: string
  readonly items: readonly NavItem[]
}

const READ_REPORTS: Permission = { resource: "report", action: "read" }
const READ_LEDGER: Permission = { resource: "ledger", action: "read" }
const PROPOSE: Permission = { resource: "ledger", action: "propose" }

/** The app's primary navigation, in sidebar order. */
export const NAVIGATION: readonly NavSection[] = [
  {
    items: [
      {
        label: "Home",
        href: "/",
        icon: HomeIcon,
        requires: READ_REPORTS,
        keywords: ["dashboard"],
      },
      {
        label: "AI inbox",
        href: "/inbox",
        icon: InboxIcon,
        requires: PROPOSE,
        keywords: ["review", "approve", "queue"],
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        label: "Revenue",
        href: "/revenue",
        icon: TrendingUpIcon,
        requires: READ_REPORTS,
        keywords: ["money in", "sales", "income"],
      },
      {
        label: "Cash",
        href: "/cash",
        icon: LandmarkIcon,
        requires: READ_REPORTS,
        keywords: ["bank", "balance", "reconciliation"],
      },
      {
        label: "Invoices",
        href: "/invoices",
        icon: FileTextIcon,
        requires: READ_LEDGER,
        keywords: ["owed to you", "receivables", "customers"],
      },
      {
        label: "Bills",
        href: "/bills",
        icon: ReceiptIcon,
        requires: READ_LEDGER,
        keywords: ["expenses", "vendors", "payables"],
      },
      {
        label: "Customers and vendors",
        href: "/parties",
        icon: UsersIcon,
        requires: READ_LEDGER,
        keywords: ["parties", "clients", "suppliers", "gstin", "contacts"],
      },
    ],
  },
  {
    label: "Compliance",
    items: [
      {
        label: "GST",
        href: "/gst",
        icon: PercentIcon,
        requires: READ_REPORTS,
        keywords: ["tax due", "gstr", "returns"],
      },
      {
        label: "Reports",
        href: "/reports",
        icon: PieChartIcon,
        requires: READ_REPORTS,
        keywords: ["profit and loss", "p&l", "balance sheet"],
      },
      {
        label: "Ledger",
        href: "/ledger",
        icon: BookOpenIcon,
        requires: READ_LEDGER,
        keywords: ["journal", "trial balance", "entries"],
      },
    ],
  },
  {
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: SettingsIcon,
        keywords: ["members", "invite", "team", "organisation"],
      },
    ],
  },
]

/** The navigation a role may see. Sections left empty are dropped. */
export function navigationFor(role: OrgRole): readonly NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.requires || can(role, item.requires)
    ),
  })).filter((section) => section.items.length > 0)
}

/** Can the role open this path? Used to guard pages, not just hide links. */
export function canOpen(role: OrgRole, href: string): boolean {
  for (const section of NAVIGATION) {
    for (const item of section.items) {
      if (item.href === href) return !item.requires || can(role, item.requires)
    }
  }
  return true
}
