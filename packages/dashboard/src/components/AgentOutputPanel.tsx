import type { AgentOutput } from "@/api/types";
import { RelativeTime } from "@/components/RelativeTime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AgentOutputPanelProps {
  readonly outputs: AgentOutput[];
}

export function AgentOutputPanel({ outputs }: AgentOutputPanelProps) {
  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle>Agent Output</CardTitle>
      </CardHeader>
      <CardContent>
        {outputs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent output recorded yet.</p>
        ) : (
          <ol className="grid gap-4">
            {outputs.map((entry) => (
              <li
                key={`${entry.issueId}-${entry.turnNumber}-${entry.recordedAt}`}
                className="grid gap-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">Turn {entry.turnNumber}</span>
                  <span className="text-muted-foreground">
                    <RelativeTime value={entry.recordedAt} />
                  </span>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-3 text-sm leading-6 text-foreground">
                  {entry.output}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
