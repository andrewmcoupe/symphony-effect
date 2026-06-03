import { useMutation, useQueryClient } from "@tanstack/react-query";

import { triggerRefresh } from "@/api/client";
import type { StateSnapshot } from "@/api/types";
import { orchestratorStateQueryKey } from "./useOrchestratorState";

interface RefreshMutationContext {
  readonly previousState: StateSnapshot | undefined;
}

export const useRefreshMutation = () => {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void, RefreshMutationContext>({
    mutationFn: triggerRefresh,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: orchestratorStateQueryKey });

      const previousState = queryClient.getQueryData<StateSnapshot>(orchestratorStateQueryKey);

      if (previousState !== undefined) {
        queryClient.setQueryData<StateSnapshot>(orchestratorStateQueryKey, {
          ...previousState,
          lastPollAt: new Date().toISOString(),
        });
      }

      return { previousState };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousState !== undefined) {
        queryClient.setQueryData(orchestratorStateQueryKey, context.previousState);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: orchestratorStateQueryKey,
      }),
  });
};
