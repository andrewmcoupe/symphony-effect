import { useQuery } from "@tanstack/react-query";

import { fetchState } from "@/api/client";
import type { StateSnapshot } from "@/api/types";

export const orchestratorStateQueryKey = ["orchestrator", "state"] as const;

export const useOrchestratorState = () =>
  useQuery<StateSnapshot, Error>({
    queryKey: orchestratorStateQueryKey,
    queryFn: fetchState,
    refetchInterval: 5_000,
  });
