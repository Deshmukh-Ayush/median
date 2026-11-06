import { z } from "zod"

export const listAccountsFiltersSchema = z.object({
  type: z
    .enum(["asset", "liability", "equity", "income", "expense"])
    .optional(),
  search: z.string().trim().max(100).optional(),
  /** Only bank accounts (for the bank-statement connection picker). */
  bankOnly: z.boolean().optional(),
})
export type ListAccountsFilters = z.input<typeof listAccountsFiltersSchema>
