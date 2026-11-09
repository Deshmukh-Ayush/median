import { describe, expect, it } from "vitest"

import { planMapping } from "./mapping"
import type { ExistingAccount } from "./mapping"
import { closingBalances, parseTallyAmount, readTally } from "./tally"
import { XmlError, escapeXml, parseXml } from "./xml"

// Tally writes a byte-order mark.
const BOM = String.fromCharCode(0xfeff)

// Shaped like a Tally Prime "All Masters" + "Day Book" export.
const EXPORT = `${BOM}<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>
   <STATICVARIABLES><SVCURRENTCOMPANY>Acme &amp; Co</SVCURRENTCOMPANY></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <GROUP NAME="Bangalore Debtors" ACTION="Create"><PARENT>Sundry Debtors</PARENT></GROUP>
   </TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="Zeta Retail" ACTION="Create">
     <PARENT>Bangalore Debtors</PARENT>
     <PARTYGSTIN>29AAPFU0939F1ZV</PARTYGSTIN>
     <OPENINGBALANCE>-11800.00</OPENINGBALANCE>
    </LEDGER>
   </TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="HDFC Bank"><PARENT>Bank Accounts</PARENT><OPENINGBALANCE>-50000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="Capital"><PARENT>Capital Account</PARENT><OPENINGBALANCE>61800.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="Sales @18%"><PARENT>Sales Accounts</PARENT></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="Output CGST"><PARENT>Duties &amp; Taxes</PARENT></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="Output SGST"><PARENT>Duties &amp; Taxes</PARENT></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="CGST"><PARENT>Duties &amp; Taxes</PARENT></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE><LEDGER NAME="Office Rent"><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE>
    <VOUCHER VCHTYPE="Sales" ACTION="Create">
     <DATE>20260410</DATE><GUID>g-1</GUID><VOUCHERNUMBER>1</VOUCHERNUMBER>
     <NARRATION>Annual plan &#4;</NARRATION>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Zeta Retail</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-23600.00</AMOUNT></ALLLEDGERENTRIES.LIST>
     <ALLINVENTORYENTRIES.LIST>
      <STOCKITEMNAME>Plan</STOCKITEMNAME>
      <ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>Sales @18%</LEDGERNAME><AMOUNT>20000.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
     </ALLINVENTORYENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST</LEDGERNAME><AMOUNT>1800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST</LEDGERNAME><AMOUNT>1800.00</AMOUNT></ALLLEDGERENTRIES.LIST>
    </VOUCHER>
   </TALLYMESSAGE>
   <TALLYMESSAGE><VOUCHER VCHTYPE="Payment"><DATE>20260415</DATE><VOUCHERNUMBER>2</VOUCHERNUMBER>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Bank</LEDGERNAME><AMOUNT>10000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER></TALLYMESSAGE>
   <TALLYMESSAGE><VOUCHER VCHTYPE="Payment"><DATE>20260416</DATE><ISCANCELLED>Yes</ISCANCELLED>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-5.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER></TALLYMESSAGE>
   <TALLYMESSAGE><VOUCHER VCHTYPE="Journal"><DATE>20260417</DATE><VOUCHERNUMBER>3</VOUCHERNUMBER>
     <ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Rent</LEDGERNAME><AMOUNT>-5.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   </VOUCHER></TALLYMESSAGE>
  </REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>`

describe("parseXml", () => {
  it("reads elements, attributes, entities and CDATA", () => {
    const root = parseXml(
      `<a x="1 &amp; 2"><b>t&lt;1&#x41;</b><c/><![CDATA[<raw>]]></a>`
    )
    expect(root.attrs["x"]).toBe("1 & 2")
    expect(root.children.map((c) => c.name)).toEqual(["b", "c"])
    expect(root.children[0]?.text).toBe("t<1A")
    expect(root.text).toBe("<raw>")
  })

  it("rejects malformed XML", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(XmlError)
    expect(() => parseXml("<a>")).toThrow(XmlError)
    expect(() => parseXml("<a/><b/>")).toThrow(XmlError)
    expect(() => parseXml("<a>&nope;</a>")).toThrow(XmlError)
  })

  it("escapes what it writes", () => {
    expect(escapeXml(`A & B <"x"> 'y'\u0004`)).toBe(
      "A &amp; B &lt;&quot;x&quot;&gt; &apos;y&apos;"
    )
  })
})

describe("parseTallyAmount", () => {
  it("keeps Tally's sign (debit negative)", () => {
    expect(parseTallyAmount("-1,234.50")).toBe(-123450n)
    expect(parseTallyAmount("₹ 10.5")).toBe(1050n)
    expect(parseTallyAmount("100.00 Dr")).toBe(-10000n)
    expect(parseTallyAmount("")).toBe(0n)
    expect(parseTallyAmount("abc")).toBeNull()
  })
})

describe("readTally", () => {
  const data = readTally(EXPORT)

  it("reads masters through user-defined groups", () => {
    expect(data.company).toBe("Acme & Co")
    const zeta = data.ledgers.find((l) => l.name === "Zeta Retail")
    expect(zeta).toMatchObject({
      nature: "debtor",
      openingPaise: 11800_00n,
      gstin: "29AAPFU0939F1ZV",
    })
    expect(data.ledgers.find((l) => l.name === "Capital")?.openingPaise).toBe(
      -61800_00n
    )
  })

  it("reads vouchers with inventory allocations, skipping cancelled ones", () => {
    expect(data.vouchers.map((v) => [v.type, v.number, v.date])).toEqual([
      ["Sales", "1", "2026-04-10"],
      ["Payment", "2", "2026-04-15"],
    ])
    expect(data.vouchers[0]?.narration).toBe("Annual plan")
    expect(data.vouchers[0]?.lines).toEqual([
      { ledger: "Zeta Retail", amountPaise: 23600_00n },
      { ledger: "Output CGST", amountPaise: -1800_00n },
      { ledger: "Output SGST", amountPaise: -1800_00n },
      { ledger: "Sales @18%", amountPaise: -20000_00n },
    ])
  })

  it("reports an unbalanced voucher instead of importing it", () => {
    expect(data.errors).toEqual([
      expect.objectContaining({
        message: "Journal 3 on 2026-04-17 doesn't balance.",
      }),
    ])
  })

  it("derives closing balances from opening plus vouchers", () => {
    const closing = closingBalances(data.ledgers, data.vouchers)
    expect(closing.get("Zeta Retail")).toBe(35400_00n)
    expect(closing.get("HDFC Bank")).toBe(40000_00n)
    expect([...closing.values()].reduce((s, v) => s + v, 0n)).toBe(0n)
  })
})

describe("planMapping", () => {
  const existing: ExistingAccount[] = [
    {
      id: "recv",
      code: "1200",
      name: "Trade receivables",
      type: "asset",
      systemKey: "trade_receivables",
    },
    {
      id: "pay",
      code: "2100",
      name: "Trade payables",
      type: "liability",
      systemKey: "trade_payables",
    },
    {
      id: "ocgst",
      code: "2210",
      name: "Output CGST",
      type: "liability",
      systemKey: "gst_output_cgst",
    },
    {
      id: "osgst",
      code: "2211",
      name: "Output SGST",
      type: "liability",
      systemKey: "gst_output_sgst",
    },
    {
      id: "susp",
      code: "2490",
      name: "Suspense",
      type: "liability",
      systemKey: "suspense",
    },
    {
      id: "re",
      code: "3300",
      name: "Retained earnings",
      type: "equity",
      systemKey: "retained_earnings",
    },
    {
      id: "rent",
      code: "5200",
      name: "Rent",
      type: "expense",
      systemKey: null,
    },
    {
      id: "bank1",
      code: "1111",
      name: "ICICI",
      type: "asset",
      systemKey: null,
    },
  ]
  const data = readTally(EXPORT)
  const plan = planMapping(
    [
      ...data.ledgers,
      {
        name: "Mystery",
        parent: "",
        nature: null,
        openingPaise: 0n,
        gstin: null,
      },
    ],
    existing
  )
  const t = (n: string) => plan.targets.get(n)

  it("maps debtors to parties and GST ledgers to system accounts", () => {
    expect(t("Zeta Retail")).toMatchObject({
      kind: "party",
      partyKind: "customer",
      accountId: "recv",
      gstin: "29AAPFU0939F1ZV",
    })
    expect(t("Output CGST")).toEqual({ kind: "account", accountId: "ocgst" })
    expect(t("Mystery")).toEqual({ kind: "account", accountId: "susp" })
  })

  it("creates other ledgers in their group's range, skipping taken codes", () => {
    expect(t("HDFC Bank")).toEqual({
      kind: "new_account",
      code: "1112",
      name: "HDFC Bank",
      type: "asset",
      isBank: true,
    })
    expect(t("Capital")).toMatchObject({
      kind: "new_account",
      code: "3100",
      type: "equity",
    })
    expect(t("Sales @18%")).toMatchObject({
      kind: "new_account",
      code: "4000",
      type: "income",
    })
    expect(t("Office Rent")).toMatchObject({
      kind: "new_account",
      code: "5201",
      type: "expense",
    })
    expect(t("CGST")).toMatchObject({ kind: "new_account", type: "liability" })
    expect(plan.warnings.some((w) => w.startsWith("CGST:"))).toBe(true)
    expect(plan.warnings.some((w) => w.startsWith("Mystery:"))).toBe(true)
  })
})
