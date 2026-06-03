import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StateBadgeProps {
  readonly state: string;
}

const stateClassName = (state: string): string => {
  switch (state.toLowerCase()) {
    case "todo":
    case "to do":
    case "backlog":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "in progress":
    case "started":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "done":
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
    case "canceled":
      return "border-stone-200 bg-stone-100 text-stone-700";
    case "blocked":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
};

export function StateBadge({ state }: StateBadgeProps) {
  return (
    <Badge variant="outline" className={cn("max-w-40 truncate", stateClassName(state))}>
      {state}
    </Badge>
  );
}
