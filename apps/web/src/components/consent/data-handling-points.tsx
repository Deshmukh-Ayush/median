/**
 * What Median does with an organisation's data: the text a member accepts
 * on the consent screen (in Settings and in onboarding). Bump
 * CURRENT_CONSENT_VERSION in @workspace/contracts when this changes.
 */
const POINTS: readonly { title: string; body: string }[] = [
  {
    title: "What we store",
    body: "Payments, refunds, settlements and bank lines from the sources you connect, the bills and statements you upload, and the entries made from them. Access tokens are encrypted, and connections are read-only.",
  },
  {
    title: "Where it's stored",
    body: "Your books and the data we pull in are in our database in the Singapore region (AWS ap-southeast-1). Documents you upload (bills, statements) are stored in the Mumbai region (Vercel Blob, bom1). Both are encrypted at rest and in transit.",
  },
  {
    title: "Who can see it",
    body: "Members of this organisation, according to the role you give them. You can remove a member at any time.",
  },
  {
    title: "Export",
    body: "An owner can export all of your organisation's data at any time.",
  },
  {
    title: "Delete",
    body: "An owner can delete your organisation's data. We remove straight away: connection credentials, uploaded documents (bills, statements), the raw data we pulled from Razorpay and your bank, the AI inbox, members and invitations, and personal contact details. Your ledger, invoices, credit notes, customer and vendor names and GSTINs, and the audit log are kept read-only, because tax law requires books to be kept for 8 years after the end of the financial year. After that they are purged.",
  },
]

export function DataHandlingPoints() {
  return (
    <ul className="flex flex-col divide-y divide-subtle rounded-lg border border-default bg-surface">
      {POINTS.map((point) => (
        <li key={point.title} className="flex flex-col gap-1 px-4 py-3">
          <h2 className="text-sm font-semibold">{point.title}</h2>
          <p className="text-sm text-fg-secondary">{point.body}</p>
        </li>
      ))}
    </ul>
  )
}
