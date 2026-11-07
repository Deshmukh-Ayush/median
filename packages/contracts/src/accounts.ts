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

/** A new bank account: a sub-account of 1110 Bank, flagged as a bank. */
export const createBankAccountInputSchema = z.object({
  /** e.g. "Current account" or "Payroll account". */
  name: z.string().trim().min(1).max(100),
  bankName: z.string().trim().min(1).max(100),
  last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Last four digits of the account number"),
})
export type CreateBankAccountInput = z.input<
  typeof createBankAccountInputSchema
>
