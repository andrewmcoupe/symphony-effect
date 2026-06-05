import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const orchestratorEventsUrl = (): string =>
  `${import.meta.env.VITE_SYMPHONY_API_BASE_URL ?? ""}/api/v1/events`;

const domainEventTypes = ["TurnRecorded", "IssueStateChanged", "TokenTotalsChanged"] as const;

export const useOrchestratorEvents = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    let closed = false;
    const source = new EventSource(orchestratorEventsUrl());
    const invalidateOrchestratorQueries = () => {
      if (!closed) {
        void queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
      }
    };

    source.onopen = invalidateOrchestratorQueries;
    source.onmessage = invalidateOrchestratorQueries;
    for (const eventType of domainEventTypes) {
      source.addEventListener(eventType, invalidateOrchestratorQueries);
    }

    return () => {
      closed = true;
      for (const eventType of domainEventTypes) {
        source.removeEventListener(eventType, invalidateOrchestratorQueries);
      }
      source.close();
    };
  }, [queryClient]);
};
