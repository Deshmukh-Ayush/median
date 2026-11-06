import { z } from "zod"

export const listAccountsFiltersSchema = z.object({
  type: z
    .enum(["asset", "liability", "equity", "income", "expense"])
    .optional(),
  search: z.string().trim().max(100).optional(),
})
export type ListAccountsFilters = z.input<typeof listAccountsFiltersSchema>
