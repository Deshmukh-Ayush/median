import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { gstStateByCode, idSchema } from "@workspace/contracts"
import type { Money as MoneyValue } from "@workspace/contracts"
import { PageHeader } from "@workspace/ui/components/app-shell"
import { Money } from "@workspace/ui/components/money"

import { CREDIT_NOTE_REASON_LABELS } from "@/lib/credit-notes"
import { formatDate } from "@/lib/format-date"
import { isIntrastate } from "@/lib/invoices"
import type { PagePropsWith } from "@/lib/page-props"
import { journalHref } from "@/lib/report-params"
import { supplyLabel } from "@/server/pdf/invoice-document"
import { getCreditNote } from "@/server/services"

import { getPageContext } from "../../../org-context"

export const metadata: Metadata = { title: "Credit note · Median" }

export default async function Page({ params }: PagePropsWith<{ id: string }>) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  const { ctx, allowed } = await getPageContext("/invoices")
  if (!allowed) notFound()
  const note = await getCreditNote(ctx, id)
  if (!note) notFound()

  const intra = isIntrastate(note.supplyType)
  const pos = gstStateByCode(note.placeOfSupply)

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={note.number}
        description={`Credit note to ${note.party.name} · ${formatDate(note.creditNoteDate)}`}
      />

      <dl className="grid gap-4 rounded-lg border border-default bg-surface p-5 text-sm sm:grid-cols-4">
        <Fact label="Against invoice">
          <Link
            href={`/invoices/${note.invoice.id}`}
            className="font-medium hover:underline"
          >
            {note.invoice.number}
          </Link>
        </Fact>
        <Fact label="Reason">{CREDIT_NOTE_REASON_LABELS[note.reason]}</Fact>
        <Fact label="Place of supply">
          {pos ? `${pos.name} (${pos.code})` : note.placeOfSupply}
          <span className="block text-xs text-fg-secondary">
            {supplyLabel(note.supplyType)}
          </span>
        </Fact>
        <Fact label="In the books">
          {note.journalEntryId ? (
            <Link
              href={journalHref({ source: "credit_note" })}
              className="hover:underline"
            >
              Posted
            </Link>
          ) : (
            "Not posted"
          )}
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
            {note.lines.map((line) => (
              <tr
                key={line.id}
                className="border-t border-default [&>td]:px-4 [&>td]:py-2"
              >
                <td>{line.description}</td>
                <td className="font-mono text-xs">{line.hsnSac}</td>
                <td className="text-right tabular-nums">{line.quantity}</td>
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
          <Total label="Taxable value" value={note.taxable} />
          {intra ? (
            <>
              <Total label="CGST" value={note.cgst} />
              <Total label="SGST" value={note.sgst} />
            </>
          ) : (
            <Total label="IGST" value={note.igst} />
          )}
          {note.roundOff !== 0n ? (
            <Total label="Round-off" value={note.roundOff} />
          ) : null}
          <Total label="Credited" value={note.total} strong />
        </dl>
      </div>

      {note.notes ? (
        <p className="text-sm text-fg-secondary">{note.notes}</p>
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
