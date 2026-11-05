import { Logo } from "@workspace/ui/components/logo"

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-app px-4 py-12">
      <Logo />
      <div className="w-full max-w-sm rounded-lg border border-default bg-surface p-6">
        {children}
      </div>
    </main>
  )
}
