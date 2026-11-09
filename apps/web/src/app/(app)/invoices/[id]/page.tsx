import type { Metadata } from "next"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { DownloadIcon } from "lucide-react"

import { gstStateByCode, idSchema } from "@workspace/contracts"
import type { Money as MoneyValue } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { buttonVariants } from "@workspace/ui/components/button"
import { Money } from "@workspace/ui/components/money"
import { StatusChip } from "@workspace/ui/components/status-chip"

import { formatDate } from "@/lib/format-date"
import type { PagePropsWith } from "@/lib/page-props"
import { INVOICE_STATUS, SUPPLY_LABELS, isIntrastate } from "@/lib/invoices"
import { getInvoice } from "@/server/services"

import { getPageContext } from "../../org-context"

export const metadata: Metadata = { title: "Invoice · Median" }

export default async function Page({ params }: PagePropsWith<{ id: string }>) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  const { ctx, allowed } = await getPageContext("/invoices")
  if (!allowed) notFound()
  const invoice = await getInvoice(ctx, id)
  if (!invoice) notFound()

  const status = INVOICE_STATUS[invoice.status]
  const pos = gstStateByCode(invoice.placeOfSupply)
  const intra = isIntrastate(invoice.supplyType)

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={invoice.number}
        description={`${invoice.party.name} · ${formatDate(invoice.invoiceDate)}`}
        actions={
          <a
            href={`/invoices/${invoice.id}/pdf`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <DownloadIcon aria-hidden />
            Download PDF
          </a>
        }
      />

      <dl className="grid gap-4 rounded-lg border border-default bg-surface p-5 text-sm sm:grid-cols-4">
        <Fact label="Status">
          <StatusChip tone={status.tone}>{status.label}</StatusChip>
        </Fact>
        <Fact label="Customer">
          {invoice.party.name}
          {invoice.party.gstin ? (
            <span className="block font-mono text-xs text-fg-secondary">
              {invoice.party.gstin}
            </span>
          ) : null}
        </Fact>
        <Fact label="Due">{formatDate(invoice.dueDate)}</Fact>
        <Fact label="Place of supply">
          {pos ? `${pos.name} (${pos.code})` : invoice.placeOfSupply}
          <span className="block text-xs text-fg-secondary">
            {SUPPLY_LABELS[invoice.supplyType]}
          </span>
          {invoice.reverseCharge ? (
            <span className="block text-xs text-fg-secondary">
              Reverse charge: the customer pays the GST
            </span>
          ) : null}
        </Fact>
      </dl>

      <div className="overflow-x-auto rounded-lg border border-default bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-secondary">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-medium">
              <th scope="col">Description</th>
              <th scope="col">HSN/SAC</th>
              <th scope="col" className="text-right">
                Qty
              </th>
              <th scope="col" className="text-right">
                Unit price
              </th>
              <th scope="col" className="text-right">
                Taxable
              </th>
              <th scope="col" className="text-right">
                Rate
              </th>
              <th scope="col" className="text-right">
                {intra ? "CGST + SGST" : "IGST"}
              </th>
              <th scope="col" className="text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr
                key={line.id}
                className="border-t border-default [&>td]:px-4 [&>td]:py-2"
              >
                <td>{line.description}</td>
                <td className="font-mono text-xs">{line.hsnSac}</td>
                <td className="text-right tabular-nums">{line.quantity}</td>
                <td className="text-right">
                  <Money value={line.unitPrice} />
                </td>
                <td className="text-right">
                  <Money value={line.taxable} />
                </td>
                <td className="text-right tabular-nums">
                  {line.gstRateBps / 100}%
                </td>
                <td className="text-right">
                  {intra ? (
                    <>
                      <Money value={line.cgst} /> + <Money value={line.sgst} />
                    </>
                  ) : (
                    <Money value={line.igst} />
                  )}
                </td>
                <td className="text-right">
                  <Money value={line.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 border-t border-default p-4 text-sm">
          <Total label="Taxable value" value={invoice.taxable} />
          {intra ? (
            <>
              <Total label="CGST" value={invoice.cgst} />
              <Total label="SGST" value={invoice.sgst} />
            </>
          ) : (
            <Total label="IGST" value={invoice.igst} />
          )}
          {invoice.roundOff !== 0n ? (
            <Total label="Round-off" value={invoice.roundOff} />
          ) : null}
          <Total label="Total" value={invoice.total} strong />
          {invoice.paid > 0n ? (
            <Total label="Received" value={invoice.paid} />
          ) : null}
          {invoice.credited > 0n ? (
            <Total label="Credit notes" value={invoice.credited} />
          ) : null}
          {invoice.paid > 0n || invoice.credited > 0n ? (
            <Total label="Outstanding" value={invoice.outstanding} strong />
          ) : null}
        </dl>
      </div>

      {invoice.notes ? (
        <p className="text-sm text-fg-secondary">{invoice.notes}</p>
      ) : null}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Total({
  label,
  value,
  strong = false,
}: {
  label: string
  value: MoneyValue
  strong?: boolean
}) {
  return (
    <>
      <dt className={strong ? "font-semibold" : "text-fg-secondary"}>
        {label}
      </dt>
      <dd className={`text-right ${strong ? "font-semibold" : ""}`}>
        <Money value={value} />
      </dd>
    </>
  )
}
