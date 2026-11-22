import { Button } from "@/components/ui/button";

export function UsageChart() {
  return (
    <main>
      <header>
        <h1>Usage</h1>
        <Button>Export</Button>
      </header>
      <section aria-label="Requests">
        <span className="inline-block size-3 animate-spin" />
        Loading the last 30 days
      </section>
    </main>
  );
}
