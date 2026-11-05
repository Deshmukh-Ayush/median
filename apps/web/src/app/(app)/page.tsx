import { PageHeader } from "@workspace/ui/components/app-shell"

/** Placeholder until the Home slice wires in getDashboardSummary. */
export default function HomePage() {
  return (
    <div className="p-6">
      <PageHeader title="Home" description="Your money at a glance." />
    </div>
  )
}
