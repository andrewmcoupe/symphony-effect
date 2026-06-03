import { Activity, Clock, Coins, RotateCcw } from "lucide-react";

import type { StateSnapshot } from "@/api/types";
import { formatDuration, formatTokenCount } from "@/components/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatsCardsProps {
  readonly state: StateSnapshot;
}

const stats = (state: StateSnapshot) => [
  {
    label: "Running",
    value: `${state.running.length}/${state.config.maxConcurrentAgents}`,
    helper: "Active agents",
    icon: Activity,
  },
  {
    label: "Retrying",
    value: state.retrying.length.toString(),
    helper: "Queued attempts",
    icon: RotateCcw,
  },
  {
    label: "Tokens",
    value: formatTokenCount(state.tokenTotals.totalTokens),
    helper: "Total used",
    icon: Coins,
  },
  {
    label: "Runtime",
    value: formatDuration(state.tokenTotals.runtimeSeconds * 1_000),
    helper: "Agent time",
    icon: Clock,
  },
];

export function StatsCards({ state }: StatsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {stats(state).map((stat) => {
        const Icon = stat.icon;

        return (
          <Card key={stat.label} className="rounded-md">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pt-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-2">
              <div className="text-2xl font-semibold">{stat.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{stat.helper}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
