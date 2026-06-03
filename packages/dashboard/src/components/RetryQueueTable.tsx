import type { RetryEntry } from "@/api/types";
import { Countdown } from "@/components/Countdown";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RetryQueueTableProps {
  readonly retrying: RetryEntry[];
}

export function RetryQueueTable({ retrying }: RetryQueueTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Identifier</TableHead>
          <TableHead className="text-right">Attempt</TableHead>
          <TableHead>Due In</TableHead>
          <TableHead>Error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {retrying.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
              No retries queued
            </TableCell>
          </TableRow>
        ) : (
          retrying.map((entry) => (
            <TableRow key={`${entry.issueId}-${entry.attempt}`}>
              <TableCell className="font-medium">
                <a
                  href={`/issues/${encodeURIComponent(entry.identifier)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {entry.identifier}
                </a>
              </TableCell>
              <TableCell className="text-right tabular-nums">{entry.attempt}</TableCell>
              <TableCell className="tabular-nums">
                <Countdown dueAt={entry.dueAt} />
              </TableCell>
              <TableCell className="max-w-[18rem] truncate" title={entry.error}>
                {entry.error}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
