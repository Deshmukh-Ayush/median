/**
 * Page props for the App Router. Spelled out instead of Next's generated
 * global PageProps, which only exists after `next typegen` (lint runs first).
 */
export type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>

export interface PagePropsWith<P extends Record<string, string>> {
  params: Promise<P>
  searchParams: SearchParams
}
