import type { OrchestratorSnapshot } from "../../orchestrator/state/index.js";

export const waitForState = async <A>(
  read: () => Promise<A>,
  predicate: (value: A) => boolean,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<A> => {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  const poll = async (): Promise<A> => {
    const value = await read();
    if (predicate(value) || Date.now() >= deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    return poll();
  };

  return poll();
};

export const hasNoRunningIssues = (snapshot: OrchestratorSnapshot): boolean =>
  snapshot.running.length === 0;
