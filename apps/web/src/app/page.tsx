import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export default function HomePage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Median</CardTitle>
          <CardDescription>
            AI-native revenue and ledger platform for Indian businesses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="primary" className="w-full">
            Get started
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
