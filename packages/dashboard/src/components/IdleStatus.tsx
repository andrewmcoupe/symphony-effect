import type { IssueDetail } from "@/api/types";
import { StateBadge } from "@/components/StateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface IdleStatusProps {
  readonly issue: IssueDetail;
}

export function IdleStatus({ issue }: IdleStatusProps) {
  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle>Status: Idle</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm font-medium text-muted-foreground">Processing</dt>
          <dd className="text-sm">Not currently being processed</dd>
          <dt className="text-sm font-medium text-muted-foreground">Last Known State</dt>
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
