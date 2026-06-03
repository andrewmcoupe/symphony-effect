import { useQuery } from "@tanstack/react-query";

import { fetchIssue } from "@/api/client";
import type { IssueDetail } from "@/api/types";

export const issueDetailQueryKey = (identifier: string) =>
  ["orchestrator", "issues", identifier] as const;

export const useIssueDetail = (identifier: string) =>
  useQuery<IssueDetail, Error>({
    queryKey: issueDetailQueryKey(identifier),
    queryFn: () => fetchIssue(identifier),
    enabled: identifier.length > 0,
    refetchInterval: 5_000,
  });
