import { getToolName, isToolUIPart } from "ai"
import type { UIMessage } from "ai"
import Link from "next/link"
import { z } from "zod"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

// What proposeJournal / proposeInvoice return (money already formatted).
// Tool output is unknown JSON on the client: parse before use.
const journalSchema = z.object({
  narration: z.string(),
  date: z.string(),
  lines: z.array(
    z.object({ account: z.string(), debit: z.string(), credit: z.string() })
  ),
  totalDebit: z.string(),
})
const invoiceSchema = z.object({
  customer: z.string(),
  taxable: z.string(),
  cgst: z.string(),
  sgst: z.string(),
  igst: z.string(),
  total: z.string(),
})
const outputSchema = z.object({
  ok: z.literal(true),
  data: z.union([journalSchema, invoiceSchema]),
})

const ZERO = "₹0.00"

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-fg-secondary">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/** Cards for what Ask Median sent to the inbox in this answer. */
export function ProposalCards({ message }: { message: UIMessage }) {
  const cards = message.parts.flatMap((part) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return []
    const name = getToolName(part)
    if (name !== "proposeJournal" && name !== "proposeInvoice") return []
    const parsed = outputSchema.safeParse(part.output)
    return parsed.success
      ? [{ id: part.toolCallId, data: parsed.data.data }]
      : []
  })
  if (cards.length === 0) return null
  return (
    <>
      {cards.map(({ id, data }) => (
        <Card key={id} size="sm">
          <CardHeader>
            <CardTitle>
              {"customer" in data
                ? `Invoice to ${data.customer}`
                : "Journal entry"}
            </CardTitle>
            <CardDescription>
              Proposed by Ask Median · waiting for approval
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {"customer" in data ? (
              <>
                <Row label="Taxable" value={data.taxable} />
                {data.cgst !== ZERO ? (
                  <Row label="CGST" value={data.cgst} />
                ) : null}
                {data.sgst !== ZERO ? (
                  <Row label="SGST" value={data.sgst} />
                ) : null}
                {data.igst !== ZERO ? (
                  <Row label="IGST" value={data.igst} />
                ) : null}
                <Row label="Total" value={data.total} />
              </>
            ) : (
              <>
                <p className="text-sm">
                  {data.narration} · {data.date}
                </p>
                {data.lines.map((l, n) => (
                  <Row
                    key={n}
                    label={`${l.debit !== ZERO ? "Dr" : "Cr"} ${l.account}`}
                    value={l.debit !== ZERO ? l.debit : l.credit}
                  />
                ))}
              </>
            )}
          </CardContent>
          <CardFooter>
            <Link href="/inbox" className="text-sm font-medium underline">
              Review in inbox
            </Link>
          </CardFooter>
        </Card>
      ))}
    </>
  )
}
