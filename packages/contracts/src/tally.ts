// Tally export: XML files Tally imports (Gateway of Tally → Import).

import type { IsoDate } from "./common"

export interface TallyExportFile {
  readonly fileName: string
  /** Tally-importable XML (ENVELOPE / IMPORTDATA), UTF-8. */
  readonly xml: string
}

export interface TallyExport {
  readonly from: IsoDate
  readonly to: IsoDate
  /** Masters first (ledgers with opening balances as of `from`), then vouchers. */
  readonly files: readonly [TallyExportFile, TallyExportFile]
  readonly ledgerCount: number
  readonly voucherCount: number
}
