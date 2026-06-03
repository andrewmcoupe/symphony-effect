import { Context, Effect, Layer } from "effect";
import type { WorkflowConfig } from "../config/index.js";
import type { Issue } from "../tracker/index.js";
import { ConcurrencyController } from "./concurrency.js";
import { OrchestratorStateRef } from "./state/index.js";

export interface DispatchDecider {
  readonly isEligible: (issue: Issue) => Effect.Effect<boolean>;
  readonly sortCandidates: (issues: readonly Issue[]) => ReadonlyArray<Issue>;
  readonly getDispatchableIssues: (
    candidates: readonly Issue[],
  ) => Effect.Effect<ReadonlyArray<Issue>>;
}

export type DispatchDeciderConfigValue = Pick<
  WorkflowConfig["tracker"],
  "active_states" | "terminal_states"
>;

export const DispatchDecider = Context.GenericTag<DispatchDecider>("symphony/DispatchDecider");

export const DispatchDeciderConfig = Context.GenericTag<DispatchDeciderConfigValue>(
  "symphony/DispatchDeciderConfig",
);

const normalizeStateName = (state: string): string => state.trim().toLowerCase();

const normalizeStateSet = (states: readonly string[]): ReadonlySet<string> =>
  new Set(states.map(normalizeStateName));

const comparePriority = (left: number | null, right: number | null): number => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
};

const hasNonTerminalBlocker = (issue: Issue, terminalStates: ReadonlySet<string>): boolean =>
  issue.blockedBy.some((blocker) => !terminalStates.has(normalizeStateName(blocker.state)));

export const makeDispatchDecider = ({
  config,
  concurrency,
  stateRef,
}: {
  readonly config: DispatchDeciderConfigValue;
  readonly concurrency: ConcurrencyController;
  readonly stateRef: OrchestratorStateRef;
}): DispatchDecider => {
  const activeStates = normalizeStateSet(config.active_states);
  const terminalStates = normalizeStateSet(config.terminal_states);

  const sortCandidates = (issues: readonly Issue[]): ReadonlyArray<Issue> =>
    issues
      .map((issue, index) => ({ issue, index }))
      .sort((left, right) => {
        const priorityOrder = comparePriority(left.issue.priority, right.issue.priority);
        if (priorityOrder !== 0) return priorityOrder;

        const createdAtOrder = left.issue.createdAt.getTime() - right.issue.createdAt.getTime();
        if (createdAtOrder !== 0) return createdAtOrder;

        return left.index - right.index;
      })
      .map(({ issue }) => issue);

  const isEligible = (issue: Issue): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const issueState = normalizeStateName(issue.state);
      if (!activeStates.has(issueState)) return false;
      if (terminalStates.has(issueState)) return false;

      const orchestratorState = yield* stateRef.getState();
      if (orchestratorState.running.has(issue.id)) return false;

      const claim = orchestratorState.claims?.get(issue.id);
      if (claim !== undefined && claim._tag !== "Unclaimed") return false;

      const canDispatch = yield* concurrency.canDispatch(issue.state);
      if (!canDispatch) return false;

      if (issueState === "todo" && hasNonTerminalBlocker(issue, terminalStates)) return false;

      return true;
    });

  const getDispatchableIssues = (
    candidates: readonly Issue[],
  ): Effect.Effect<ReadonlyArray<Issue>> =>
    Effect.forEach(candidates, (issue) =>
      isEligible(issue).pipe(Effect.map((eligible) => ({ issue, eligible }))),
    ).pipe(
      Effect.map((results) =>
        sortCandidates(results.filter(({ eligible }) => eligible).map(({ issue }) => issue)),
      ),
    );

  return {
    isEligible,
    sortCandidates,
    getDispatchableIssues,
  };
};

export const DispatchDeciderLive: Layer.Layer<
  DispatchDecider,
  never,
  ConcurrencyController | DispatchDeciderConfigValue | OrchestratorStateRef
> = Layer.effect(
  DispatchDecider,
  Effect.gen(function* () {
    const config = yield* DispatchDeciderConfig;
    const concurrency = yield* ConcurrencyController;
    const stateRef = yield* OrchestratorStateRef;
    return makeDispatchDecider({ config, concurrency, stateRef });
  }),
);

export const makeDispatchDeciderLive = (
  config: DispatchDeciderConfigValue,
): Layer.Layer<DispatchDecider, never, ConcurrencyController | OrchestratorStateRef> =>
  DispatchDeciderLive.pipe(Layer.provide(Layer.succeed(DispatchDeciderConfig, config)));
