import { GST_STATES } from "@workspace/contracts"

import type { StateOption } from "@/components/parties/party-form"

/** States a customer or vendor can be registered in. */
export const PARTY_STATES: readonly StateOption[] = GST_STATES.filter(
  (s) => s.active
).map((s) => ({ code: s.code, name: s.name }))
