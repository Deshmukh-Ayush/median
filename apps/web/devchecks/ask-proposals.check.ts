// Ask Median proposals end to end on the dev database: propose → inbox →
// approve / reject. Creates a throwaway org "Test Proposals" each run.
//   npm run test:dev-db -- ask-proposals
// ASK_DEMO=1 also runs the two demo prompts through the real model.
import { paise } from "@workspace/ledger"
import { and, eq } from "drizzle-orm"
import { createIdGenerator, readUIMessageStream, toUIMessageStream } from "ai"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { getDb } from "../src/server/db"
import { auditLog, inboxItems, organization } from "../src/server/db/schema"
import type { OrgContext } from "../src/server/services/context"
import { freshDevOrg } from "./setup"

/** Read without process.env.X, which turbo wants declared per task. */
const env = (name: string): string | undefined => process.env[name]

const host = new URL(process.env["DATABASE_URL"] ?? "x://none").host
if (!host.includes("lucky-leaf") || host.includes("royal-violet"))
  throw new Error(`Refusing to run on ${host}: ep-lucky-leaf only.`)

async function testOrg(): Promise<OrgContext> {
  const ctx = await freshDevOrg("test-proposals")
  await getDb()
    .update(organization)
    .set({ name: "Test Proposals" })
    .where(eq(organization.id, ctx.orgId))
  const s = await import("../src/server/services")
  await s.updateGstProfile(ctx, {
    legalName: "Test Proposals Private Limited",
    gstin: "29AAICT1234F1Z5",
    stateCode: "29",
    gstRegistered: true,
    compositionScheme: false,
    defaultGstRateBps: 1800,
  })
  await s.createParty(ctx, {
    kind: "customer",
    name: "Orbit Labs",
    stateCode: "29",
  })
  return ctx
}

async function accountName(ctx: OrgContext, code: string): Promise<string> {
  const s = await import("../src/server/services")
  const page = await s.listLedgerAccounts(ctx, null, { search: code }, {})
  const a = page.items.find((x) => x.code === code)
  if (!a) throw new Error(`no account ${code}`)
  return a.name
}

async function balanced(ctx: OrgContext) {
  const s = await import("../src/server/services")
  const tb = await s.getTrialBalance(ctx, "2026-12-31")
  expect(tb.totalDebit).toBe(tb.totalCredit)
  return tb
}

describe("Ask Median proposals", () => {
  it("journal and invoice: propose → approve posts; reject posts nothing", async () => {
    const s = await import("../src/server/services")
    const ctx = await testOrg()
    const rent = await accountName(ctx, "5200")
    const bank = await accountName(ctx, "1110")

    // Unbalanced is refused in code, nothing reaches the inbox.
    await expect(
      s.proposeJournal(
        ctx,
        {
          narration: "Bad",
          date: "2026-11-12",
          lines: [
            { accountName: rent, debitPaise: 100n },
            { accountName: bank, creditPaise: 99n },
          ],
        },
        "conv-test"
      )
    ).rejects.toMatchObject({ code: "UNBALANCED" })

    const j = await s.proposeJournal(
      ctx,
      {
        narration: "Office rent, November",
        date: "2026-11-12",
        lines: [
          { accountName: rent, debitPaise: 40_000_00n },
          { accountName: bank, creditPaise: 40_000_00n },
        ],
      },
      "conv-test"
    )
    const [jRow] = await getDb()
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, j.inboxItemId))
    expect(jRow).toMatchObject({
      kind: "ask_proposal",
      sourceType: "conversation",
      conversationId: "conv-test",
      reason: "Proposed by Ask Median",
      status: "pending",
      postedEntryId: null,
    })
    await balanced(ctx)

    const jApproved = await s.approveInboxItem(ctx, j.inboxItemId)
    expect(jApproved.item.status).toBe("approved")

    const inv = await s.proposeInvoice(
      ctx,
      {
        customerName: "orbit labs",
        date: "2026-11-12",
        lines: [
          {
            description: "Consulting, November",
            hsnSac: "998311",
            gstRateBps: 1800,
            amountPaise: 1_00_000_00n,
          },
        ],
      },
      "conv-test"
    )
    expect(inv).toMatchObject({
      taxable: paise(1_00_000_00n),
      cgst: paise(9_000_00n),
      sgst: paise(9_000_00n),
      igst: paise(0n),
      total: paise(1_18_000_00n),
    })
    const invApproved = await s.approveInboxItem(ctx, inv.inboxItemId)
    const invoices = await s.listInvoices(ctx, null, {}, {})
    expect(invoices.items).toHaveLength(1)
    expect(invoices.items[0]).toMatchObject({
      total: paise(1_18_000_00n),
      journalEntryId: invApproved.entryId,
    })

    const r = await s.proposeJournal(
      ctx,
      {
        narration: "To reject",
        date: "2026-11-12",
        lines: [
          { accountName: rent, debitPaise: 1_00n },
          { accountName: bank, creditPaise: 1_00n },
        ],
      },
      "conv-test"
    )
    const entriesBefore = (await s.listEntries(ctx, {}, null, { limit: 200 }))
      .items.length
    const rejected = await s.rejectInboxItem(ctx, r.inboxItemId, "Test")
    expect(rejected.status).toBe("rejected")
    expect(rejected.postedEntryId).toBeNull()
    expect(
      (await s.listEntries(ctx, {}, null, { limit: 200 })).items.length
    ).toBe(entriesBefore)

    const tb = await balanced(ctx)
    expect(tb.totalDebit > 0n).toBe(true)

    const audits = await getDb()
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, ctx.orgId),
          eq(auditLog.source, "ask_median")
        )
      )
    expect(audits.filter((a) => a.action === "inbox.propose")).toHaveLength(3)
    const approvals = audits.filter(
      (a) => a.action === "inbox.approve_ask_proposal"
    )
    expect(approvals).toHaveLength(2)
    expect(JSON.stringify(approvals[0]?.after)).toContain(
      "proposed by Ask Median (conversation conv-test), approved by"
    )
    console.info("[ask-proposals] org", ctx.orgId, "TB", tb.totalDebit)
  })

  it.runIf(env("ASK_DEMO") === "1")(
    "demo prompts through the model",
    async () => {
      const { ask } = await import("../src/server/ai/ask/ask")
      const s = await import("../src/server/services")
      const ctx = await testOrg()
      const ids = createIdGenerator({ prefix: "m", size: 8 })

      async function turn(history: UIMessage[], text: string) {
        const messages: UIMessage[] = [
          ...history,
          { id: ids(), role: "user", parts: [{ type: "text", text }] },
        ]
        const r = await ask(ctx, {
          messages,
          today: "2026-11-12",
          conversationId: "demo-conv",
        })
        let last: UIMessage | undefined
        for await (const m of readUIMessageStream({
          stream: toUIMessageStream({ stream: r.stream }),
        }))
          last = m
        if (!last) throw new Error("no answer")
        const said = last.parts
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("")
        const tools = last.parts
          .filter((p) => p.type.startsWith("tool-"))
          .map((p) => p.type)
        console.info(`\n> ${text}\n${said}\n[tools: ${tools.join(", ")}]`)
        return { messages: [...messages, last], said, tools }
      }

      const pending = async () =>
        (await s.listInboxItems(ctx, null, { kind: "ask_proposal" }, {})).items
          .length

      const j1 = await turn(
        [],
        "Record office rent of ₹40,000 paid today from the bank current account."
      )
      expect(j1.tools).not.toContain("tool-proposeJournal")
      expect(await pending()).toBe(0)
      const j2 = await turn(j1.messages, "Yes")
      expect(j2.tools).toContain("tool-proposeJournal")
      expect(await pending()).toBe(1)

      const i1 = await turn(
        [],
        "Invoice Orbit Labs ₹1,00,000 for consulting, SAC 998311, 18% GST."
      )
      expect(i1.tools).not.toContain("tool-proposeInvoice")
      const i2 = await turn(i1.messages, "Yes")
      expect(i2.tools).toContain("tool-proposeInvoice")
      expect(await pending()).toBe(2)
      await balanced(ctx)
    }
  )
})
