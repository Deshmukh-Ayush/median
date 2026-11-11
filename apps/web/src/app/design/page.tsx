import type { Metadata } from "next"
import { notFound } from "next/navigation"
import {
  BanknoteIcon,
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
} from "lucide-react"

import {
  AppShell,
  PageHeader,
  TopBar,
} from "@workspace/ui/components/app-shell"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@workspace/ui/components/command"
import { CommandBar } from "@workspace/ui/components/command-bar"
import type { CommandBarGroup } from "@workspace/ui/components/command-bar"
import { ConfidenceBadge } from "@workspace/ui/components/confidence-badge"
import {
  DataTable,
  DataTablePagination,
} from "@workspace/ui/components/data-table"
import type { DataTableColumn } from "@workspace/ui/components/data-table"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Input } from "@workspace/ui/components/input"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { Label } from "@workspace/ui/components/label"
import { Logo, LogoMark } from "@workspace/ui/components/logo"
import { Money } from "@workspace/ui/components/money"
import { Sidebar } from "@workspace/ui/components/sidebar"
import type { SidebarSection } from "@workspace/ui/components/sidebar"
import { SourceLink } from "@workspace/ui/components/source-link"
import { Toaster } from "@workspace/ui/components/sonner"
import { StatCard } from "@workspace/ui/components/stat-card"
import { StatusChip } from "@workspace/ui/components/status-chip"
import type { StatusTone } from "@workspace/ui/components/status-chip"
import { Textarea } from "@workspace/ui/components/textarea"
import { AA_NORMAL_TEXT, contrastRatio } from "@workspace/ui/lib/contrast"
import {
  colorGroups,
  contrastPairs,
  density,
  motion,
  radii,
  spacing,
  tokenValue,
  typeScale,
} from "@workspace/ui/lib/tokens"
import type { ColorToken, TokenName } from "@workspace/ui/lib/tokens"

import { InboxView } from "@/components/inbox/inbox-view"

import {
  previewApprove,
  previewApproveOne,
  previewReject,
} from "./inbox-preview-actions"
import { inboxRows, invoices, moneySamples, stats } from "./sample-data"
import type { SampleInvoice } from "./sample-data"

export const metadata: Metadata = {
  title: "Design system · Median",
  robots: { index: false, follow: false },
}

/** Interaction states, forced with data-preview so they show without a pointer. */
const STATES = [
  { label: "Default", preview: undefined },
  { label: "Hover", preview: "hover" },
  { label: "Focus", preview: "focus" },
  { label: "Active", preview: "active" },
] as const

const nav: readonly SidebarSection[] = [
  {
    items: [
      { label: "Home", href: "/", icon: <HomeIcon /> },
      { label: "AI inbox", href: "/inbox", icon: <InboxIcon />, count: 12 },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Revenue", href: "/revenue", icon: <TrendingUpIcon /> },
      { label: "Cash", href: "/cash", icon: <LandmarkIcon /> },
      { label: "Invoices", href: "/invoices", icon: <FileTextIcon /> },
      { label: "Bills", href: "/bills", icon: <ReceiptIcon /> },
    ],
  },
  {
    label: "Compliance",
    items: [
      { label: "GST", href: "/gst", icon: <PercentIcon /> },
      { label: "Reports", href: "/reports", icon: <PieChartIcon /> },
      { label: "Ledger", href: "/ledger", icon: <BookOpenIcon /> },
    ],
  },
  {
    items: [{ label: "Settings", href: "/settings", icon: <SettingsIcon /> }],
  },
]

const commandGroups: readonly CommandBarGroup[] = [
  {
    heading: "Go to",
    items: [
      {
        id: "home",
        label: "Home",
        href: "/",
        icon: <HomeIcon />,
        shortcut: ["G", "H"],
      },
      {
        id: "inbox",
        label: "AI inbox",
        href: "/inbox",
        icon: <InboxIcon />,
        shortcut: ["G", "I"],
      },
      {
        id: "invoices",
        label: "Invoices",
        href: "/invoices",
        icon: <FileTextIcon />,
        keywords: ["receivables", "owed to you"],
      },
      {
        id: "gst",
        label: "GST",
        href: "/gst",
        icon: <PercentIcon />,
        keywords: ["tax due", "gstr"],
      },
    ],
  },
  {
    heading: "Actions",
    items: [
      {
        id: "new-invoice",
        label: "Create invoice",
        href: "/invoices/new",
        icon: <FileTextIcon />,
        shortcut: ["C"],
      },
      {
        id: "upload-bill",
        label: "Upload a bill",
        href: "/bills/upload",
        icon: <ReceiptIcon />,
      },
    ],
  },
]

const STATUS: Record<
  SampleInvoice["status"],
  { label: string; tone: StatusTone }
> = {
  paid: { label: "Paid", tone: "success" },
  due: { label: "Due", tone: "neutral" },
  overdue: { label: "Overdue", tone: "danger" },
  draft: { label: "Draft", tone: "neutral" },
}

const invoiceColumns: readonly DataTableColumn<SampleInvoice>[] = [
  {
    id: "number",
    header: "Invoice",
    cell: (row) => (
      <a
        href={`#${row.id}`}
        data-row-link
        className="font-medium text-fg hover:underline"
      >
        {row.number}
      </a>
    ),
    className: "w-28",
  },
  { id: "customer", header: "Customer", cell: (row) => row.customer },
  {
    id: "issued",
    header: "Issued",
    cell: (row) => <span className="text-fg-secondary">{row.issued}</span>,
    className: "w-24",
  },
  {
    id: "due",
    header: "Due",
    cell: (row) => <span className="text-fg-secondary">{row.due}</span>,
    className: "w-24",
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => (
      <StatusChip tone={STATUS[row.status].tone}>
        {STATUS[row.status].label}
      </StatusChip>
    ),
    className: "w-28",
  },
  {
    id: "amount",
    header: "Amount",
    numeric: true,
    cell: (row) => (
      <Money
        value={row.amount}
        tone={row.status === "overdue" ? "danger" : "default"}
      />
    ),
    className: "w-36",
  },
]

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-6 flex-col gap-4"
    >
      <div className="flex flex-col gap-1 border-b border-faint pb-2">
        <h2 id={`${id}-title`} className="text-md font-semibold text-fg">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl text-sm text-fg-secondary">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function Panel({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-default bg-surface p-4 ${className ?? ""}`}
    >
      {title ? (
        <p className="text-xs font-medium text-fg-secondary">{title}</p>
      ) : null}
      {children}
    </div>
  )
}

function Ratio({
  fg,
  bg,
  min = AA_NORMAL_TEXT,
  note,
}: {
  fg: string
  bg: string
  /** 4.5 for text, 3 for UI boundaries, 0 when decorative or exempt. */
  min?: number
  note?: string
}) {
  const ratio = contrastRatio(fg, bg)
  const pass = ratio >= min
  if (note) {
    return (
      <span className="tabular text-xs text-fg-secondary">
        {ratio.toFixed(2)}:1 · {note}
      </span>
    )
  }
  return (
    <span
      className={`tabular text-xs ${pass ? "text-fg-secondary" : "font-medium text-danger"}`}
    >
      {ratio.toFixed(2)}:1{pass ? "" : " ✕"}
    </span>
  )
}

interface SwatchPair {
  against: string
  fg: string
  bg: string
  min?: number
  note?: string
}

function swatchContrast(token: ColorToken): SwatchPair | null {
  const v = token.value
  const panel = tokenValue("--bg-panel")
  const name: string = token.name
  if (name === "--on-accent")
    return { against: "on accent", fg: v, bg: tokenValue("--accent") }
  if (name === "--text-faint")
    return { against: "on panel", fg: v, bg: panel, note: "exempt (disabled)" }
  if (name === "--icon")
    return {
      against: "on canvas (icon, 3:1)",
      fg: v,
      bg: tokenValue("--bg-canvas"),
      min: 3,
    }
  if (name.startsWith("--bg-"))
    return { against: "body text", fg: tokenValue("--text"), bg: v }
  if (name.startsWith("--text-") || name === "--accent-text")
    return { against: "on panel", fg: v, bg: panel }
  if (name.startsWith("--accent"))
    return { against: "white text", fg: tokenValue("--on-accent"), bg: v }
  if (name.endsWith("-dot"))
    return { against: "on panel", fg: v, bg: panel, note: "beside a label" }
  if (name.startsWith("--status-") && !name.endsWith("-soft")) {
    return {
      against: "on soft",
      fg: v,
      bg: tokenValue(`${token.name}-soft` as TokenName),
    }
  }
  if (name === "--border-input" || name === "--focus-ring")
    return { against: "on panel (UI, 3:1)", fg: v, bg: panel, min: 3 }
  if (name.startsWith("--border"))
    return { against: "on panel", fg: v, bg: panel, note: "decorative" }
  return null
}

function Swatch({ token }: { token: ColorToken }) {
  const pair = swatchContrast(token)
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-default bg-surface">
      <div
        className="h-14 border-b border-faint"
        style={{ background: token.value }}
      />
      <div className="flex flex-col gap-0.5 p-2.5">
        <p className="font-mono text-xs font-medium text-fg">{token.name}</p>
        <p className="tabular text-xs text-fg-secondary">{token.value}</p>
        <p className="text-2xs text-fg-secondary">{token.use}</p>
        {pair ? (
          <p className="flex items-center gap-1 text-2xs text-fg-secondary">
            {pair.against}:{" "}
            <Ratio
              fg={pair.fg}
              bg={pair.bg}
              {...(pair.min === undefined ? {} : { min: pair.min })}
              {...(pair.note === undefined ? {} : { note: pair.note })}
            />
          </p>
        ) : null}
      </div>
    </div>
  )
}

function StateGrid({
  rows,
}: {
  rows: readonly {
    label: string
    render: (preview: string | undefined) => React.ReactNode
  }[]
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-default bg-surface">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="h-8 border-b border-default px-3 text-left text-xs font-medium text-fg-secondary" />
            {STATES.map((state) => (
              <th
                key={state.label}
                className="h-8 border-b border-default px-3 text-left text-xs font-medium text-fg-secondary"
              >
                {state.label}
              </th>
            ))}
            <th className="h-8 border-b border-default px-3 text-left text-xs font-medium text-fg-secondary">
              Disabled
            </th>
            <th className="h-8 border-b border-default px-3 text-left text-xs font-medium text-fg-secondary">
              Loading / error
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="border-b border-faint px-3 py-3 text-left text-xs font-medium whitespace-nowrap text-fg-secondary"
              >
                {row.label}
              </th>
              {STATES.map((state) => (
                <td
                  key={state.label}
                  className="border-b border-faint px-3 py-3"
                >
                  {row.render(state.preview)}
                </td>
              ))}
              <td className="border-b border-faint px-3 py-3">
                {row.render("disabled")}
              </td>
              <td className="border-b border-faint px-3 py-3">
                {row.render("loading")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dashboard() {
  return (
    <div className="overflow-hidden rounded-xl border border-default">
      <AppShell
        className="h-[760px]"
        sidebar={
          <Sidebar
            header={<Logo />}
            sections={nav}
            currentHref="/"
            footer={
              <div className="flex flex-col px-2 py-1">
                <span className="text-sm font-medium text-fg">Kaveri Labs</span>
                <span className="text-xs text-fg-secondary">Owner · SaaS</span>
              </div>
            }
          />
        }
        topBar={
          <TopBar actions={<CommandBar groups={commandGroups} />}>
            <span className="text-fg">Home</span>
          </TopBar>
        }
      >
        <div className="flex flex-col gap-6 p-6">
          <PageHeader
            title="Good morning, Kaveri Labs"
            description="November so far. Every number opens the entries behind it."
            actions={
              <>
                <Button variant="secondary">Upload a bill</Button>
                <Button variant="primary">Create invoice</Button>
              </>
            }
          />
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Money in"
              href="#money-in"
              value={stats.moneyIn.value}
              compact
              change={{
                amount: stats.moneyIn.change,
                percent: stats.moneyIn.percent,
                period: "vs October",
              }}
            />
            <StatCard
              label="Owed to you"
              href="#owed"
              value={stats.owedToYou.value}
              compact
              change={{
                amount: stats.owedToYou.change,
                percent: stats.owedToYou.percent,
                period: "vs October",
              }}
            />
            <StatCard
              label="Tax due"
              href="#tax"
              value={stats.taxDue.value}
              compact
              change={{
                amount: stats.taxDue.change,
                percent: stats.taxDue.percent,
                period: "vs October",
              }}
            />
            <StatCard
              label="Cash in bank"
              href="#cash"
              value={stats.cash.value}
              compact
              change={{
                amount: stats.cash.change,
                percent: stats.cash.percent,
                period: "vs October",
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">Recent invoices</h2>
              <Button variant="ghost" size="sm">
                View all
              </Button>
            </div>
            <DataTable
              label="Recent invoices"
              columns={invoiceColumns}
              rows={invoices.slice(0, 5)}
              getRowId={(row) => row.id}
              pagination={
                <DataTablePagination
                  summary="5 of 142 invoices"
                  nextHref="?cursor=inv_138"
                />
              }
            />
          </div>
        </div>
      </AppShell>
    </div>
  )
}

export default function DesignPage() {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- set by Next itself, not a build input
  if (process.env.NODE_ENV === "production") notFound()

  return (
    <div className="min-h-svh bg-app">
      <header className="sticky top-0 z-20 border-b border-faint bg-app/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-6">
          <LogoMark className="size-5" />
          <span className="text-sm font-semibold">Design system v2</span>
          <StatusChip tone="info">Dev only</StatusChip>
          <nav aria-label="Sections" className="ml-auto flex gap-1 text-xs">
            {[
              "colours",
              "contrast",
              "type",
              "shape",
              "components",
              "dashboard",
            ].map((id) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-md px-2 py-1 text-fg-secondary capitalize hover:bg-hover hover:text-fg"
              >
                {id}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-10">
        <PageHeader
          title="Median design system"
          description="Calm, dense, keyboard-first. Light theme only; every value below is a CSS variable a dark theme can override."
        />

        <Section
          id="dashboard"
          title="In context"
          description="Sidebar, a row of StatCards, a DataTable, and one primary button. The accent appears exactly twice: the logo and “Create invoice”."
        >
          <Dashboard />
        </Section>

        <Section
          id="inbox"
          title="AI inbox"
          description="One queue for all work. j/k to move, a to approve, r to reject, x to select for bulk approval. Preview actions post nothing."
        >
          <InboxView
            rows={[...inboxRows]}
            canApprove
            canReject
            tdsSections={["194C", "194J"]}
            approveItem={previewApproveOne}
            approveItems={previewApprove}
            rejectItem={previewReject}
          />
        </Section>

        <Section
          id="colours"
          title="Colour tokens"
          description="Ratios are WCAG contrast for the pairing named under each swatch. ✕ marks a pairing that fails AA and must not be used for text."
        >
          {colorGroups.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-fg-secondary">
                {group.label}
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {group.tokens.map((token) => (
                  <Swatch key={token.name} token={token} />
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section
          id="contrast"
          title="Text contrast"
          description="Every text-on-background pair the system allows, checked in CI by scripts/contrast.test.ts. Tertiary text is not allowed on hover or selected backgrounds (4.32 and 4.05); rows use secondary text there."
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {contrastPairs.map((pair) => (
              <div
                key={`${pair.fg}-${pair.bg}`}
                className="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2"
                style={{ background: tokenValue(pair.bg) }}
              >
                <span
                  className="text-sm font-medium"
                  style={{ color: tokenValue(pair.fg) }}
                >
                  ₹1,23,456 Aa
                </span>
                <span
                  className="flex flex-col items-end"
                  style={{ color: tokenValue(pair.fg) }}
                >
                  <span className="font-mono text-2xs">
                    {pair.fg.replace("--", "")} / {pair.bg.replace("--", "")}
                  </span>
                  <span className="tabular text-xs font-medium">
                    {contrastRatio(
                      tokenValue(pair.fg),
                      tokenValue(pair.bg)
                    ).toFixed(2)}
                    :1
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="type"
          title="Type"
          description="Inter for UI; Inter Display (Inter at optical size 32) for page titles. Weights 400, 500 and 600 only. Tabular figures everywhere."
        >
          <Panel>
            <p className="font-display text-xl font-semibold">
              Page title · Inter Display 24/600
            </p>
            <div className="flex flex-col divide-y divide-faint">
              {typeScale.map((step) => (
                <div
                  key={step.className}
                  className="flex items-baseline gap-6 py-2"
                >
                  <span className="w-64 shrink-0 font-mono text-2xs text-fg-secondary">
                    {step.className} · {step.spec}
                  </span>
                  <span className={`${step.className} text-fg`}>
                    Money owed to you ₹12,34,567
                  </span>
                  <span className="ml-auto text-2xs text-fg-secondary">
                    {step.use}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-8 pt-2 text-base">
              <span className="font-normal">Regular 400</span>
              <span className="font-medium">Medium 500</span>
              <span className="font-semibold">Semibold 600</span>
            </div>
            <div className="grid grid-cols-2 gap-6 pt-2">
              <div>
                <p className="pb-1 text-2xs text-fg-secondary">
                  Tabular figures (default)
                </p>
                <p className="flex flex-col text-right text-base">
                  <span>₹1,11,111</span>
                  <span>₹8,88,888</span>
                  <span>₹40,10,000</span>
                </p>
              </div>
              <div>
                <p className="pb-1 text-2xs text-fg-secondary">
                  Proportional (not used for numbers)
                </p>
                <p className="flex flex-col text-right text-base [font-variant-numeric:proportional-nums]">
                  <span>₹1,11,111</span>
                  <span>₹8,88,888</span>
                  <span>₹40,10,000</span>
                </p>
              </div>
            </div>
          </Panel>
        </Section>

        <Section id="shape" title="Spacing, radius, elevation, motion, density">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title="Spacing · 4px grid">
              <div className="flex flex-col gap-1.5">
                {spacing.map((px) => (
                  <div key={px} className="flex items-center gap-3">
                    <span className="w-10 text-right tabular text-2xs text-fg-secondary">
                      {px}px
                    </span>
                    <span
                      className="h-3 rounded-sm bg-selected"
                      style={{ width: px * 4 }}
                    />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Radius">
              <div className="flex gap-4">
                {radii.map((radius) => (
                  <div
                    key={radius.className}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={`size-16 border border-default bg-app ${radius.className}`}
                    />
                    <span className="text-2xs font-medium">{radius.px}px</span>
                    <span className="text-center text-2xs text-fg-secondary">
                      {radius.use}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Elevation · colour and border; shadows only on overlays">
              <div className="flex gap-4 rounded-md bg-app p-4">
                <div className="flex h-20 flex-1 items-center justify-center rounded-lg border border-default bg-surface text-xs text-fg-secondary">
                  Card: border, no shadow
                </div>
                <div className="flex h-20 flex-1 items-center justify-center rounded-lg border border-default bg-surface text-xs text-fg-secondary shadow-overlay">
                  Overlay: soft shadow
                </div>
              </div>
            </Panel>
            <Panel title="Motion · ease-out, no bounce, off with prefers-reduced-motion">
              <div className="flex gap-3">
                {motion.map((m) => (
                  <div
                    key={m.name}
                    tabIndex={0}
                    className="flex h-16 flex-1 flex-col items-center justify-center rounded-md border border-default bg-surface text-xs transition-colors hover:bg-selected focus-visible:bg-selected"
                    style={{ transitionDuration: `${m.ms}ms` }}
                  >
                    <span className="font-medium">{m.ms}ms</span>
                    <span className="text-2xs text-fg-secondary">
                      {m.use} · hover me
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                {density.map((d) => (
                  <span key={d.name} className="text-xs text-fg-secondary">
                    {d.name}{" "}
                    <span className="tabular font-medium text-fg">
                      {d.px}px
                    </span>
                  </span>
                ))}
              </div>
            </Panel>
          </div>
        </Section>

        <Section
          id="components"
          title="Components"
          description="Hover, focus and active are forced with data-preview so they show here; the real components respond to the pointer and keyboard."
        >
          <h3 className="text-xs font-medium text-fg-secondary">Button</h3>
          <StateGrid
            rows={(["primary", "secondary", "ghost", "danger"] as const).map(
              (variant) => ({
                label: variant,
                render: (preview) => (
                  <Button
                    variant={variant}
                    data-preview={
                      preview === "disabled" || preview === "loading"
                        ? undefined
                        : preview
                    }
                    disabled={preview === "disabled"}
                    loading={preview === "loading"}
                  >
                    {variant === "primary"
                      ? "Approve"
                      : variant === "danger"
                        ? "Reject"
                        : variant === "ghost"
                          ? "Skip"
                          : "Edit"}
                  </Button>
                ),
              })
            )}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Settings">
              <SettingsIcon />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Settings">
              <SettingsIcon />
            </Button>
          </div>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">Inputs</h3>
          <StateGrid
            rows={[
              {
                label: "Input",
                render: (preview) =>
                  preview === "loading" ? (
                    <Input
                      aria-label="GSTIN"
                      defaultValue="29ABCDE1234F1Z"
                      aria-invalid
                      className="w-36"
                    />
                  ) : (
                    <Input
                      aria-label="GSTIN"
                      placeholder="29ABCDE1234F1Z5"
                      data-preview={
                        preview === "disabled" ? undefined : preview
                      }
                      disabled={preview === "disabled"}
                      className="w-36"
                    />
                  ),
              },
            ]}
          />
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="design-gstin">GSTIN</Label>
              <Input
                id="design-gstin"
                defaultValue="29ABCDE1234F1Z"
                aria-invalid
                aria-describedby="design-gstin-error"
              />
              <p id="design-gstin-error" className="text-xs text-danger">
                GSTIN is 15 characters. This one has 14.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="design-note">Note to customer</Label>
              <Textarea
                id="design-note"
                placeholder="Thanks for your business."
                rows={2}
              />
            </div>
          </div>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">Money</h3>
          <Panel>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-fg-secondary">
                  <th className="pb-2 text-left font-medium">Case</th>
                  <th className="pb-2 text-right font-medium">
                    Default (exact)
                  </th>
                  <th className="pb-2 text-right font-medium">roundToRupee</th>
                  <th className="pb-2 text-right font-medium">
                    compact (lakh/crore)
                  </th>
                  <th className="pb-2 text-right font-medium">Ledger</th>
                </tr>
              </thead>
              <tbody>
                {moneySamples.map((sample) => (
                  <tr key={sample.label} className="border-t border-faint">
                    <td className="py-1.5 text-fg-secondary">{sample.label}</td>
                    <td className="py-1.5 text-right">
                      <Money value={sample.value} />
                    </td>
                    <td className="py-1.5 text-right">
                      <Money value={sample.value} roundToRupee />
                    </td>
                    <td className="py-1.5 text-right">
                      <Money value={sample.value} compact />
                    </td>
                    <td className="py-1.5 text-right">
                      <Money value={sample.value} variant="ledger" />
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-faint">
                  <td className="py-1.5 text-fg-secondary">
                    Real problem (overdue)
                  </td>
                  <td className="py-1.5 text-right" colSpan={4}>
                    <Money value={stats.cash.change} tone="danger" />
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            StatCard
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Money in"
              value={stats.moneyIn.value}
              change={{
                amount: stats.moneyIn.change,
                percent: stats.moneyIn.percent,
                period: "vs October",
              }}
            />
            <StatCard
              label="Owed to you · hover"
              href="#owed"
              data-preview="hover"
              value={stats.owedToYou.value}
              compact
              change={{ amount: stats.owedToYou.change, period: "vs October" }}
            />
            <StatCard label="Tax due" loading />
            <StatCard
              label="Cash in bank"
              error="Couldn't reach the bank feed. Retrying."
            />
          </div>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            StatusChip · ConfidenceBadge · Kbd · Badge
          </h3>
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip>Draft</StatusChip>
              <StatusChip tone="success">Paid</StatusChip>
              <StatusChip tone="warning">Due in 3 days</StatusChip>
              <StatusChip tone="danger">Overdue</StatusChip>
              <StatusChip tone="info">Synced</StatusChip>
              <StatusChip tone="danger" dot>
                Needs review
              </StatusChip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceBadge
                score={0.96}
                reason="GSTIN and totals match the printed invoice."
              />
              <ConfidenceBadge
                score={0.78}
                reason="HSN code is partly obscured."
              />
              <ConfidenceBadge
                score={0.41}
                reason="Scanned at an angle; vendor name unclear."
              />
              <ConfidenceBadge level="high" />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-fg-secondary">
              <span className="flex items-center gap-1.5">
                Command bar
                <KbdGroup>
                  <Kbd>Ctrl</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </span>
              <span className="flex items-center gap-1.5">
                Next / previous <Kbd>J</Kbd> <Kbd>K</Kbd>
              </span>
              <span className="flex items-center gap-1.5">
                Approve <Kbd>A</Kbd>
              </span>
              <span className="flex items-center gap-1.5">
                Reject <Kbd>R</Kbd>
              </span>
              <Badge>12 waiting</Badge>
              <Badge variant="outline">Beta</Badge>
            </div>
          </Panel>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            SourceLink
          </h3>
          <StateGrid
            rows={[
              {
                label: "SourceLink",
                render: (preview) =>
                  preview === "disabled" ? (
                    <SourceLink />
                  ) : preview === "loading" ? (
                    <SourceLink href="#" loading />
                  ) : (
                    <SourceLink href="#bill" data-preview={preview}>
                      Bill INV-2291.pdf
                    </SourceLink>
                  ),
              },
            ]}
          />

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            DataTable
          </h3>
          <p className="text-xs text-fg-secondary">
            Click a row, then use <Kbd>J</Kbd> <Kbd>K</Kbd> or the arrow keys,{" "}
            <Kbd>Home</Kbd> <Kbd>End</Kbd>, and <Kbd>Enter</Kbd> to open. The
            selected row is neutral.
          </p>
          <DataTable
            label="Invoices"
            columns={invoiceColumns}
            rows={invoices}
            getRowId={(row) => row.id}
            selectedRowId="inv_3"
            maxHeight="240px"
            pagination={
              <DataTablePagination
                summary="Showing 6 of 142"
                previousHref="?before=inv_143"
                nextHref="?after=inv_138"
              />
            }
          />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <DataTable
              label="Loading"
              columns={invoiceColumns.slice(1)}
              rows={[]}
              getRowId={(row) => row.id}
              loading
              skeletonRows={3}
            />
            <DataTable
              label="Error"
              columns={invoiceColumns.slice(1)}
              rows={[]}
              getRowId={(row) => row.id}
              error="Couldn't load invoices. Try again."
            />
            <DataTable
              label="Empty"
              columns={invoiceColumns.slice(1, 3)}
              rows={[]}
              getRowId={(row) => row.id}
              empty={
                <EmptyState
                  icon={<FileTextIcon />}
                  title="No invoices yet"
                  description="Invoices you create or import show up here."
                  action={<Button size="sm">Create invoice</Button>}
                />
              }
            />
          </div>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            EmptyState
          </h3>
          <Panel>
            <EmptyState
              icon={<InboxIcon />}
              title="Nothing to review"
              description="When the AI reads a bill or matches a bank line, it lands here for your approval."
              action={<Button>Upload a bill</Button>}
            />
          </Panel>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            Sidebar
          </h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="h-[480px] w-(--sidebar-width) overflow-hidden rounded-lg border border-default bg-sidebar">
              <Sidebar
                header={<Logo />}
                sections={nav}
                currentHref="/invoices"
              />
            </div>
            <Panel title="Item states">
              <div className="w-(--sidebar-width) rounded-md bg-sidebar p-2">
                {STATES.map((state) => (
                  <a
                    key={state.label}
                    href="#sidebar"
                    data-preview={state.preview}
                    className="flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg-secondary transition-colors hover:bg-hover hover:text-fg active:bg-selected [&>svg]:size-4"
                  >
                    <FileTextIcon /> {state.label}
                  </a>
                ))}
                <a
                  href="#sidebar"
                  aria-current="page"
                  className="flex h-7 items-center gap-2 rounded-md bg-selected px-2 text-sm font-medium text-fg [&>svg]:size-4"
                >
                  <FileTextIcon /> Selected (current page)
                </a>
                <span
                  aria-disabled
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg-disabled [&>svg]:size-4"
                >
                  <FileTextIcon /> Disabled
                </span>
              </div>
            </Panel>
          </div>

          <h3 className="pt-4 text-xs font-medium text-fg-secondary">
            CommandBar
          </h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title="Trigger · press Ctrl/⌘ K anywhere on this page">
              <CommandBar groups={commandGroups} />
            </Panel>
            <Panel title="Open (static preview)">
              <div className="overflow-hidden rounded-lg border border-default bg-surface shadow-overlay">
                <Command>
                  <CommandInput placeholder="Search or jump to…" />
                  <CommandList className="p-1">
                    <CommandGroup heading="Go to">
                      <CommandItem value="home">
                        <HomeIcon /> Home
                        <CommandShortcut>
                          <KbdGroup>
                            <Kbd>G</Kbd>
                            <Kbd>H</Kbd>
                          </KbdGroup>
                        </CommandShortcut>
                      </CommandItem>
                      <CommandItem value="inbox">
                        <InboxIcon /> AI inbox
                      </CommandItem>
                      <CommandItem value="invoices">
                        <FileTextIcon /> Invoices
                      </CommandItem>
                      <CommandItem value="cash">
                        <BanknoteIcon /> Cash
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            </Panel>
          </div>
        </Section>
      </main>
      <Toaster />
    </div>
  )
}
