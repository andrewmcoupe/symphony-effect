import { Link } from "@tanstack/react-router";

import type { RunningIssue } from "@/api/types";
import { formatDuration } from "@/components/format";
import { StateBadge } from "@/components/StateBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNow } from "@/components/useNow";

interface RunningAgentsTableProps {
  readonly running: RunningIssue[];
}

export function RunningAgentsTable({ running }: RunningAgentsTableProps) {
  const now = useNow();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Identifier</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Latest Output</TableHead>
          <TableHead className="text-right">Turn Count</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Elapsed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {running.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
              No agents running
            </TableCell>
          </TableRow>
        ) : (
          running.map((issue) => {
            const startedAtMs = new Date(issue.startedAt).getTime();
            const elapsedMs = Number.isNaN(startedAtMs) ? issue.elapsedMs : now - startedAtMs;

            return (
              <TableRow key={issue.issueId}>
                <TableCell className="font-medium">
                  <Link
                    to="/issues/$identifier"
                    params={{ identifier: issue.identifier }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {issue.identifier}
                  </Link>
                </TableCell>
                <TableCell>
                  <StateBadge state={issue.state} />
                </TableCell>
                <TableCell className="max-w-80">
                  {issue.latestAgentOutput === undefined ? (
                    <span className="text-sm text-muted-foreground">No output yet</span>
                  ) : (
                    <p className="max-h-10 overflow-hidden break-words text-sm leading-5 text-muted-foreground">
                      {issue.latestAgentOutput.output}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{issue.turnCount}</TableCell>
                <TableCell>
                  <time
                    dateTime={issue.startedAt}
                    title={new Date(issue.startedAt).toLocaleString()}
                  >
                    {new Date(issue.startedAt).toLocaleTimeString()}
                  </time>
                </TableCell>
                <TableCell className="tabular-nums">{formatDuration(elapsedMs)}</TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
