import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: DashboardHome,
});

function DashboardHome() {
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Orchestrator visibility will appear here as API hooks are added.
          </p>
        </div>
        <Badge variant="secondary">Setup</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Observability Shell</CardTitle>
          <CardDescription>
            The base app is ready for status, workers, and issue detail views.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            TanStack Query, TanStack Router, Tailwind CSS, and shadcn/ui are configured.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
