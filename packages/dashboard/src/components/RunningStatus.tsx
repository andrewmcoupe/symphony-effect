import type { IssueDetail } from "@/api/types";
import { formatDuration } from "@/components/format";
import { StateBadge } from "@/components/StateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/components/useNow";

interface RunningStatusProps {
  readonly issue: IssueDetail;
}

export function RunningStatus({ issue }: RunningStatusProps) {
  const now = useNow();
  const running = issue.running;

  if (running === undefined) {
    return null;
  }

  const startedAtMs = new Date(running.startedAt).getTime();
  const elapsedMs = Number.isNaN(startedAtMs) ? running.elapsedMs : now - startedAtMs;

  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle>Status: Running</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm font-medium text-muted-foreground">Turn Count</dt>
          <dd className="text-sm tabular-nums">{running.turnCount}</dd>
          <dt className="text-sm font-medium text-muted-foreground">Started</dt>
          <dd className="text-sm">
            <time dateTime={running.startedAt}>{new Date(running.startedAt).toLocaleString()}</time>
          </dd>
          <dt className="text-sm font-medium text-muted-foreground">Elapsed</dt>
          <dd className="text-sm tabular-nums">{formatDuration(elapsedMs)}</dd>
          <dt className="text-sm font-medium text-muted-foreground">Tracker State</dt>
          <dd className="text-sm">
            {issue.state === undefined ? (
              <span className="text-muted-foreground">Unknown</span>
            ) : (
              <StateBadge state={issue.state} />
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
