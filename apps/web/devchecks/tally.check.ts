import { expect, it } from "vitest"
import { importFile } from "../src/server/services/connectors"
import { getTrialBalance } from "../src/server/services/reports"
import { exportTally } from "../src/server/services/tally"
import { freshDevOrg } from "./setup"

const XML = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
 <TALLYMESSAGE><LEDGER NAME="Zeta Retail"><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>29AAPFU0939F1ZR</PARTYGSTIN><OPENINGBALANCE>-11800.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><LEDGER NAME="HDFC Bank"><PARENT>Bank Accounts</PARENT><OPENINGBALANCE>-50000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><LEDGER NAME="Capital"><PARENT>Capital Account</PARENT><OPENINGBALANCE>61800.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><LEDGER NAME="Sales @18%"><PARENT>Sales Accounts</PARENT></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><LEDGER NAME="Output CGST"><PARENT>Duties &amp; Taxes</PARENT></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><LEDGER NAME="Output SGST"><PARENT>Duties &amp; Taxes</PARENT></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><LEDGER NAME="Office Rent"><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>
 <TALLYMESSAGE><VOUCHER VCHTYPE="Sales"><DATE>20260410</DATE><GUID>g-1</GUID><VOUCHERNUMBER>1</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Zeta Retail</LEDGERNAME><AMOUNT>-23600.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales @18%</LEDGERNAME><AMOUNT>20000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST</LEDGERNAME><AMOUNT>1800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST</LEDGERNAME><AMOUNT>1800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER></TALLYMESSAGE>
 <TALLYMESSAGE><VOUCHER VCHTYPE="Payment"><DATE>20260415</DATE><GUID>g-2</GUID><VOUCHERNUMBER>2</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 </VOUCHER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`

const file = (text: string) =>
  ({ kind: "text", fileName: "tally.xml", mimeType: "text/xml", text }) as const

/** Non-zero closing balances by account name. */
async function balances(ctx: Awaited<ReturnType<typeof freshDevOrg>>) {
  const tb = await getTrialBalance(ctx, "2026-12-31")
  return Object.fromEntries(
    tb.rows
      .filter((r) => r.debit !== 0n || r.credit !== 0n)
      .map((r) => [r.name, r.debit - r.credit])
  )
}

it("Tally import, re-import, export and round trip", async () => {
  const ctx = await freshDevOrg("tally")
  const first = await importFile(ctx, "tally-import", file(XML))
  console.log(
    "import",
    JSON.stringify(
      first,
      (_key: string, v: unknown) => (typeof v === "bigint" ? String(v) : v),
      1
    )
  )
  expect(first.errors).toEqual([])
  expect(first.tally?.trialBalanceMatches).toBe(true)
  expect(first.posted).toBe(5) // 3 opening balances in one entry + 2 vouchers

  const again = await importFile(ctx, "tally-import", file(XML))
  expect(again.imported).toBe(0)
  expect(again.posted).toBe(0)
  expect(again.tally?.trialBalanceMatches).toBe(true)

  const books = await balances(ctx)
  expect(books).toMatchObject({
    "HDFC Bank": 40_000_00n,
    "Trade receivables": 35_400_00n,
    Capital: -61_800_00n,
    "Sales @18%": -20_000_00n,
    "Output CGST": -1_800_00n,
    "Office Rent": 10_000_00n,
  })

  // Export and import into another org: the same trial balance.
  const out = await exportTally(ctx, "2026-04-01", "2026-12-31")
  expect(out.voucherCount).toBe(3)
  const copy = await freshDevOrg("tally-copy")
  const m = await importFile(copy, "tally-import", file(out.files[0].xml))
  const v = await importFile(copy, "tally-import", file(out.files[1].xml))
  expect([...m.errors, ...v.errors]).toEqual([])
  expect(v.tally?.trialBalanceMatches).toBe(true)
  expect(await balances(copy)).toEqual(books)
})
