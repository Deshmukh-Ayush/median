import { Skeleton } from "@workspace/ui/components/skeleton"

/** Shown while a screen's first data loads; pages stream the rest. */
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  )
}
