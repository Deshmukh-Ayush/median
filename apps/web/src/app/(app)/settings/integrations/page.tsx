import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import {
  ChevronLeftIcon,
  PlugIcon,
  RefreshCwIcon,
  UnplugIcon,
} from "lucide-react"

import { isServiceError } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { Button } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { StatusChip } from "@workspace/ui/components/status-chip"

import {
  FileImportForm,
  TestKeysForm,
} from "@/components/integrations/connector-forms"
import { formatDateTime } from "@/lib/format-date"
import type { SearchParams } from "@/lib/page-props"
import { can } from "@/lib/permissions"
import {
  getConsentStatus,
  listConnections,
  listConnectors,
  listLedgerAccounts,
} from "@/server/services"
import type {
  ConnectionStatus,
  ConnectionSummary,
  ConnectorCategory,
  ConnectorInfo,
  OrgContext,
} from "@/server/services"

import { getOrgContextOrRedirect } from "../../org-context"
import {
  connectRazorpay,
  connectRazorpayTestKeys,
  disconnectConnection,
  importConnectorFile,
  saveSettlementBank,
  syncNow,
} from "./actions"
import { isTestMode } from "./mode"

export const metadata: Metadata = { title: "Integrations · Median" }

const CATEGORIES: readonly { id: ConnectorCategory; label: string }[] = [
  { id: "payments", label: "Payments" },
  { id: "banks", label: "Banks" },
  { id: "accounting", label: "Accounting" },
  { id: "sales_channels", label: "Sales channels" },
  { id: "payroll", label: "Payroll" },
]

const STATUS: Record<
  ConnectionStatus,
  {
    label: string
    tone: "success" | "info" | "warning" | "danger" | "neutral"
    reconnect: boolean
  }
> = {
  connected: { label: "Connected", tone: "success", reconnect: false },
  syncing: { label: "Syncing", tone: "info", reconnect: false },
  error: { label: "Sync failed", tone: "danger", reconnect: false },
  reconnect_required: {
    label: "Reconnect required",
    tone: "warning",
    reconnect: true,
  },
  revoked: { label: "Revoked", tone: "danger", reconnect: true },
  disconnected: { label: "Disconnected", tone: "neutral", reconnect: false },
}

/** Fixed messages for ?status=…; never echo text from the URL. */
const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  connected: {
    tone: "success",
    text: "Razorpay is connected. First sync is on its way.",
  },
  declined: {
    tone: "danger",
    text: "Razorpay access wasn't granted. Connect again when you're ready.",
  },
  expired: {
    tone: "danger",
    text: "That Razorpay link expired or was for another organisation. Try connecting again.",
  },
  failed: { tone: "danger", text: "That didn't work. Try again in a minute." },
  settlement_saved: { tone: "success", text: "Settlement bank account saved." },
  sync_failed: {
    tone: "danger",
    text: "Sync didn't finish. Try again in a minute.",
  },
}

interface BankAccountOption {
  readonly id: string
  readonly label: string
}

/** Which bank account Razorpay pays settlements into. No client JS. */
function SettlementBankPicker({
  connection,
  bankAccounts,
}: {
  connection: ConnectionSummary
  bankAccounts: readonly BankAccountOption[]
}) {
  const id = `settlement-${connection.id}`
  return (
    <form
      action={saveSettlementBank.bind(null, connection.id)}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium">
          Settlements paid into
        </label>
        <select
          // Remount after a save so the saved value shows.
          key={connection.settlementBankAccountId ?? "default"}
          id={id}
          name="settlementBankAccountId"
          defaultValue={connection.settlementBankAccountId ?? ""}
          className="h-8 min-w-56 rounded-sm border border-input bg-surface px-2 text-sm"
        >
          <option value="">First bank account (default)</option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm">
        Save
      </Button>
    </form>
  )
}

function ConnectionRow({
  connection,
  canManage,
  canSync,
  bankAccounts,
}: {
  connection: ConnectionSummary
  canManage: boolean
  canSync: boolean
  bankAccounts: readonly BankAccountOption[]
}) {
  const status = STATUS[connection.status]
  const live = connection.status !== "disconnected"
  return (
    <li className="flex flex-col gap-2 border-t border-faint pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{connection.label}</span>
        {connection.mode === "test" ? (
          <StatusChip tone="info">Test mode</StatusChip>
        ) : null}
        <StatusChip tone={status.tone} dot>
          {status.label}
        </StatusChip>
        {connection.keyHint ? (
          <span className="font-mono text-xs text-fg-secondary">
            {connection.keyHint}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-fg-secondary">
        {connection.lastSyncedAt
          ? `Last synced ${formatDateTime(connection.lastSyncedAt)}`
          : "Not synced yet"}
        {connection.lastError ? ` · ${connection.lastError}` : null}
      </p>
      {live && canManage && connection.provider.startsWith("razorpay") ? (
        <SettlementBankPicker
          connection={connection}
          bankAccounts={bankAccounts}
        />
      ) : null}
      {canManage || canSync ? (
        <div className="flex flex-wrap gap-2">
          {status.reconnect &&
          canManage &&
          connection.provider === "razorpay" ? (
            <form action={connectRazorpay}>
              <Button type="submit" size="sm" variant="primary">
                <PlugIcon aria-hidden /> Reconnect
              </Button>
            </form>
          ) : null}
          {live &&
          !status.reconnect &&
          canSync &&
          connection.authType !== "file" ? (
            <form action={syncNow.bind(null, connection.id)}>
              <Button type="submit" size="sm">
                <RefreshCwIcon aria-hidden /> Sync now
              </Button>
            </form>
          ) : null}
          {live && canManage ? (
            <form action={disconnectConnection.bind(null, connection.id)}>
              <Button type="submit" size="sm" variant="ghost">
                <UnplugIcon aria-hidden /> Disconnect
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function ConnectorCard({
  connector,
  connections,
  canManage,
  canSync,
  testMode,
  bankAccounts,
}: {
  connector: ConnectorInfo
  connections: readonly ConnectionSummary[]
  canManage: boolean
  canSync: boolean
  testMode: boolean
  bankAccounts: readonly BankAccountOption[]
}) {
  const comingSoon = connector.availability === "coming_soon"
  const active = connections.filter((c) => c.status !== "disconnected")
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-default bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{connector.displayName}</h3>
          <p className="text-sm text-fg-secondary">{connector.description}</p>
        </div>
        {comingSoon ? <StatusChip>Coming soon</StatusChip> : null}
        {connector.testModeOnly && !comingSoon ? (
          <StatusChip tone="info">Test mode</StatusChip>
        ) : null}
      </header>

      {connections.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              canManage={canManage}
              canSync={canSync}
              bankAccounts={bankAccounts}
            />
          ))}
        </ul>
      ) : null}

      {comingSoon || !canManage ? null : connector.authType === "oauth" ? (
        active.length === 0 ? (
          <form action={connectRazorpay}>
            <Button type="submit" size="sm" variant="primary">
              <PlugIcon aria-hidden /> Connect {connector.displayName}
            </Button>
            <p className="mt-2 text-xs text-fg-secondary">
              You approve read-only access on Razorpay&apos;s own screen. We
              never see your password.
            </p>
          </form>
        ) : null
      ) : connector.authType === "api_key" ? (
        testMode && active.length === 0 ? (
          <TestKeysForm action={connectRazorpayTestKeys} />
        ) : null
      ) : connector.provider === "bank-statement" ? (
        active.length > 0 && canSync ? (
          <FileImportForm
            action={importConnectorFile}
            provider={connector.provider}
            accept={connector.accepts}
            buttonLabel="Upload statement"
            connections={active.map((c) => ({ id: c.id, label: c.label }))}
          />
        ) : (
          <p className="text-xs text-fg-secondary">
            Add a bank account from Cash to upload its statements.
          </p>
        )
      ) : canSync ? (
        <FileImportForm
          action={importConnectorFile}
          provider={connector.provider}
          accept={connector.accepts}
          buttonLabel="Upload report"
        />
      ) : null}
    </li>
  )
}

/** Which connectors to show: the test-keys card only in test mode. */
function visibleConnectors(
  connectors: readonly ConnectorInfo[],
  testMode: boolean
): readonly ConnectorInfo[] {
  return connectors.filter((c) => testMode || !c.testModeOnly)
}

async function Gallery({ ctx }: { ctx: OrgContext }) {
  let data
  try {
    const [connectors, connections, consent] = await Promise.all([
      listConnectors(),
      listConnections(ctx),
      getConsentStatus(ctx),
    ])
    data = { connectors, connections, consent }
  } catch (error) {
    if (!isServiceError(error)) throw error
    return (
      <div className="rounded-lg border border-default bg-surface">
        <EmptyState
          icon={<PlugIcon />}
          title="We couldn't load your integrations"
          description={error.message}
        />
      </div>
    )
  }

  const testMode = isTestMode()
  const canManage = can(ctx.role, { resource: "settings", action: "update" })
  const canSync = can(ctx.role, { resource: "ledger", action: "post" })
  const byProvider = new Map<string, ConnectionSummary[]>()
  for (const connection of data.connections) {
    const list = byProvider.get(connection.provider) ?? []
    list.push(connection)
    byProvider.set(connection.provider, list)
  }
  const connectors = visibleConnectors(data.connectors, testMode)

  // Bank accounts for the Razorpay settlement picker, only when it shows.
  const needsBanks =
    canManage &&
    data.connections.some(
      (c) => c.provider.startsWith("razorpay") && c.status !== "disconnected"
    )
  const bankAccounts: BankAccountOption[] = needsBanks
    ? (await listLedgerAccounts(ctx, null, { bankOnly: true })).items.map(
        (a) => ({
          id: a.id,
          label: [
            a.code,
            a.bankName,
            a.name,
            a.accountLast4 ? `··${a.accountLast4}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })
      )
    : []

  return (
    <div className="flex flex-col gap-8">
      {!data.consent.accepted && canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-surface px-4 py-3 text-sm">
          <span>
            Before connecting anything, review how Median handles your data.
          </span>
          <Link
            href="/settings/integrations/consent"
            className="font-medium underline underline-offset-2"
          >
            Review and accept
          </Link>
        </div>
      ) : null}
      {CATEGORIES.map((category) => {
        const inCategory = connectors.filter((c) => c.category === category.id)
        if (inCategory.length === 0) return null
        return (
          <section
            key={category.id}
            aria-labelledby={`cat-${category.id}`}
            className="flex flex-col gap-3"
          >
            <h2
              id={`cat-${category.id}`}
              className="text-sm font-semibold text-fg-secondary"
            >
              {category.label}
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {inCategory.map((connector) => (
                <ConnectorCard
                  key={connector.provider}
                  connector={connector}
                  connections={byProvider.get(connector.provider) ?? []}
                  canManage={canManage}
                  canSync={canSync}
                  testMode={testMode}
                  bankAccounts={bankAccounts}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function GallerySkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-lg" />
      ))}
    </div>
  )
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const ctx = await getOrgContextOrRedirect()
  const raw = (await searchParams).status
  const notice = typeof raw === "string" ? NOTICES[raw] : undefined
  return (
    <div className="flex max-w-4xl flex-col gap-6 p-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg"
      >
        <ChevronLeftIcon aria-hidden className="size-4" /> Settings
      </Link>
      <PageHeader
        title="Integrations"
        description="Connect your payments and bank so the books keep themselves."
      />
      {notice ? (
        <p
          role={notice.tone === "danger" ? "alert" : "status"}
          className={
            notice.tone === "danger"
              ? "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
              : "rounded-md bg-success-soft px-3 py-2 text-sm text-success"
          }
        >
          {notice.text}
        </p>
      ) : null}
      <Suspense fallback={<GallerySkeleton />}>
        <Gallery ctx={ctx} />
      </Suspense>
    </div>
  )
}
