import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";

import { RelativeTime } from "@/components/RelativeTime";
import { RetryQueueTable } from "@/components/RetryQueueTable";
import { RunningAgentsTable } from "@/components/RunningAgentsTable";
import { StatsCards } from "@/components/StatsCards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrchestratorState, useRefreshMutation } from "@/hooks";

export const Route = createFileRoute("/")({
  component: DashboardHome,
});

function DashboardHome() {
  const stateQuery = useOrchestratorState();
  const refreshMutation = useRefreshMutation();
  const isRefreshing = refreshMutation.isPending;

  if (stateQuery.isLoading) {
    return <OverviewSkeleton />;
  }

  if (stateQuery.isError) {
    return (
      <section className="grid gap-4">
        <PageHeader isRefreshing={isRefreshing} onRefresh={() => refreshMutation.mutate()} />
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>Unable to load orchestrator state</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {stateQuery.error?.message ?? "The dashboard could not reach the Symphony API."}
            </p>
            <div>
              <Button variant="outline" onClick={() => void stateQuery.refetch()}>
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const state = stateQuery.data;

  if (state === undefined) {
    return <OverviewSkeleton />;
  }

  return (
    <section className="grid gap-4">
      <PageHeader isRefreshing={isRefreshing} onRefresh={() => refreshMutation.mutate()} />
      <StatsCards state={state} />
      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Running Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <RunningAgentsTable running={state.running} />
        </CardContent>
      </Card>
      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>Retry Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <RetryQueueTable retrying={state.retrying} />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Last poll: <RelativeTime value={state.lastPollAt} />
      </p>
    </section>
  );
}

interface PageHeaderProps {
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}

function PageHeader({ isRefreshing, onRefresh }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Symphony Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Running agents, queued retries, and aggregate token usage.
        </p>
      </div>
      <Button onClick={onRefresh} disabled={isRefreshing}>
        {isRefreshing ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <RefreshCw aria-hidden="true" />
        )}
        {isRefreshing ? "Refreshing" : "Refresh"}
      </Button>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <section className="grid gap-4" aria-label="Loading dashboard overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-2">
          <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {["running", "retrying", "tokens", "runtime"].map((key) => (
          <Card key={key} className="rounded-md">
            <CardContent className="grid gap-3 px-4 py-4">
              <div className="h-4 w-24 animate-pulse rounded-md bg-muted" />
              <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-28 animate-pulse rounded-md bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      {["running-agents", "retry-queue"].map((key) => (
        <Card key={key} className="rounded-md">
          <CardHeader>
            <div className="h-5 w-36 animate-pulse rounded-md bg-muted" />
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
