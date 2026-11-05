import { isAPIError } from "better-auth/api"
import { z } from "zod"

const apiErrorBodySchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
})

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: "That email and password don't match.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  PASSWORD_TOO_LONG: "Use at most 128 characters for your password.",
  USER_ALREADY_EXISTS:
    "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in instead.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED:
    "Sign-up with email isn't switched on yet. Ask your Median contact.",
  EMAIL_PASSWORD_DISABLED:
    "Sign-in with email isn't switched on yet. Ask your Median contact.",
  ORGANIZATION_ALREADY_EXISTS:
    "That organisation address is taken. Try a slightly different name.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    "That person is already a member.",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    "That person already has a pending invite.",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    "Only owners can invite people.",
  INVITATION_NOT_FOUND: "This invite no longer exists. Ask for a new one.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    "This invite was sent to a different email. Sign in with that email.",
}

/**
 * A message safe to show the user for a Better Auth error, or null if `error`
 * isn't one (the caller should rethrow it).
 */
export function authErrorMessage(error: unknown): string | null {
  if (!isAPIError(error)) return null
  const body = apiErrorBodySchema.safeParse(error.body)
  const code = body.success ? body.data.code : undefined
  if (code && MESSAGES[code]) return MESSAGES[code]
  return "Something went wrong. Please try again."
}
