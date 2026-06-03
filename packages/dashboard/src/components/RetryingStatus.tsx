import type { IssueDetail } from "@/api/types";
import { Countdown } from "@/components/Countdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RetryingStatusProps {
  readonly issue: IssueDetail;
}

export function RetryingStatus({ issue }: RetryingStatusProps) {
  const retry = issue.retry;

  if (retry === undefined) {
    return null;
  }

  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle>Status: Waiting for Retry</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm font-medium text-muted-foreground">Attempt</dt>
          <dd className="text-sm tabular-nums">{retry.attempt} of infinity</dd>
          <dt className="text-sm font-medium text-muted-foreground">Due Time</dt>
          <dd className="text-sm">
            <time dateTime={retry.dueAt}>{new Date(retry.dueAt).toLocaleString()}</time>
          </dd>
          <dt className="text-sm font-medium text-muted-foreground">Next Retry</dt>
          <dd className="text-sm tabular-nums">
            <Countdown dueAt={retry.dueAt} />
          </dd>
          <dt className="text-sm font-medium text-muted-foreground">Error</dt>
          <dd className="min-w-0">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-3 text-sm leading-6 text-foreground">
              {retry.error}
            </pre>
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
