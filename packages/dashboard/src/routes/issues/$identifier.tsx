import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { ApiError } from "@/api/client";
import { IdleStatus } from "@/components/IdleStatus";
import { IssueHeader } from "@/components/IssueHeader";
import { RetryingStatus } from "@/components/RetryingStatus";
import { RunningStatus } from "@/components/RunningStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useIssueDetail } from "@/hooks";

export const Route = createFileRoute("/issues/$identifier")({
  component: IssueDetailPage,
});

function IssueDetailPage() {
  const { identifier } = Route.useParams();
  const issueQuery = useIssueDetail(identifier);

  if (issueQuery.isLoading) {
    return <IssueDetailSkeleton identifier={identifier} />;
  }

  if (issueQuery.isError) {
    const isNotFound = issueQuery.error instanceof ApiError && issueQuery.error.status === 404;

    return (
      <section className="grid gap-5">
        <IssueNavigation identifier={identifier} />
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>{isNotFound ? "Issue not found" : "Unable to load issue"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              {isNotFound
                ? `${identifier} is not currently known to the orchestrator.`
                : issueQuery.error.message}
            </p>
            <div>
              <Button variant="outline" onClick={() => void issueQuery.refetch()}>
                <RefreshCw aria-hidden="true" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    );
  }

  const issue = issueQuery.data;

  if (issue === undefined) {
    return <IssueDetailSkeleton identifier={identifier} />;
  }

  return (
    <section className="grid gap-5">
      <IssueNavigation identifier={issue.identifier} />
      <IssueHeader issue={issue} />
      {issue.status === "running" ? <RunningStatus issue={issue} /> : null}
      {issue.status === "retrying" ? <RetryingStatus issue={issue} /> : null}
      {issue.status === "idle" ? <IdleStatus issue={issue} /> : null}
    </section>
  );
}

interface IssueNavigationProps {
  readonly identifier: string;
}

function IssueNavigation({ identifier }: IssueNavigationProps) {
  return (
    <div className="grid gap-2">
      <Button asChild variant="ghost" className="w-fit px-0 hover:bg-transparent">
        <Link to="/">
          <ArrowLeft aria-hidden="true" />
          Dashboard
        </Link>
      </Button>
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground hover:underline">
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-foreground">{identifier}</span>
      </nav>
    </div>
  );
}

function IssueDetailSkeleton({ identifier }: IssueNavigationProps) {
  return (
    <section className="grid gap-5" aria-label="Loading issue detail">
      <IssueNavigation identifier={identifier} />
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="grid gap-2">
          <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />
          <div className="h-6 w-20 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
      </div>
      <Card className="rounded-md">
        <CardHeader>
          <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-3/5 animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
    </section>
  );
}
