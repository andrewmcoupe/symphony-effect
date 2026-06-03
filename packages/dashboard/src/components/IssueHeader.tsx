import { ExternalLink } from "lucide-react";

import type { IssueDetail } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface IssueHeaderProps {
  readonly issue: IssueDetail;
}

const statusLabel = (status: IssueDetail["status"]): string => {
  switch (status) {
    case "running":
      return "Running";
    case "retrying":
      return "Retrying";
    case "idle":
      return "Idle";
  }
};

const statusClassName = (status: IssueDetail["status"]): string => {
  switch (status) {
    case "running":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "retrying":
      return "border-red-200 bg-red-50 text-red-700";
    case "idle":
      return "border-stone-200 bg-stone-100 text-stone-700";
  }
};

export function IssueHeader({ issue }: IssueHeaderProps) {
  const linearUrl = `https://linear.app/team/issue/${encodeURIComponent(issue.identifier)}`;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">{issue.identifier}</h1>
        <Badge variant="outline" className={cn("w-fit", statusClassName(issue.status))}>
          {statusLabel(issue.status)}
        </Badge>
      </div>
      <Button asChild variant="outline">
        <a href={linearUrl} target="_blank" rel="noreferrer">
          <ExternalLink aria-hidden="true" />
          Linear
        </a>
      </Button>
    </div>
  );
}
