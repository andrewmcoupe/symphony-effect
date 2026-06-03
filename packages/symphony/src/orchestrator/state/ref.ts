import { Context, Effect, Fiber, Layer, Ref } from "effect";
import {
  claimIssueMutation,
  getSnapshot,
  incrementTokensMutation,
  initialOrchestratorState,
  markRetryQueuedMutation,
  markRunningMutation,
  recordPollMutation,
  recordRuntimeConfigMutation,
  recordTurnMutation,
  releaseIssueMutation,
  resolveIssueIdentifier,
  takeDueRetriesMutation,
  updateActivityMutation,
  updateTrackerStateMutation,
} from "./mutations.js";
import type {
  MarkRetryQueuedOptions,
  OrchestratorSnapshot,
  OrchestratorState,
  RetryEntry,
  RuntimeConfigSnapshot,
  TokenUsageDelta,
  WorkerError,
} from "./types.js";

export interface OrchestratorStateRef {
  readonly claimIssue: (issueId: string, identifier?: string) => Effect.Effect<void>;
  readonly markRunning: (
    issueId: string,
    fiber: Fiber.RuntimeFiber<void, WorkerError>,
    identifier?: string,
    trackerState?: string,
    attempt?: number | null,
  ) => Effect.Effect<void>;
  readonly markRetryQueued: (
    issueId: string,
    attempt: number,
    error: string,
    options?: MarkRetryQueuedOptions,
  ) => Effect.Effect<void>;
  readonly takeDueRetries: (now?: number) => Effect.Effect<ReadonlyArray<RetryEntry>>;
  readonly releaseIssue: (issueId: string) => Effect.Effect<void>;
  readonly updateActivity: (issueId: string) => Effect.Effect<void>;
  readonly updateTrackerState: (issueId: string, trackerState: string) => Effect.Effect<void>;
  readonly recordTurn: (issueId: string, trackerState?: string) => Effect.Effect<void>;
  readonly incrementTokens: (usage: TokenUsageDelta) => Effect.Effect<void>;
  readonly recordRuntimeConfig: (config: RuntimeConfigSnapshot) => Effect.Effect<void>;
  readonly recordPoll: (lastPollAt?: number) => Effect.Effect<void>;
  readonly getState: () => Effect.Effect<OrchestratorState>;
  readonly getSnapshot: () => Effect.Effect<OrchestratorSnapshot>;
}

export const OrchestratorStateRef = Context.GenericTag<OrchestratorStateRef>(
  "symphony/OrchestratorStateRef",
);

export const makeOrchestratorStateRef = (
  ref: Ref.Ref<OrchestratorState>,
): OrchestratorStateRef => ({
  claimIssue: (issueId, identifier) => Ref.update(ref, claimIssueMutation(issueId, identifier)),
  markRunning: (issueId, fiber, identifier, trackerState, attempt) =>
    Ref.update(ref, (state) => {
      const now = Date.now();
      const existing = state.running.get(issueId);
      const currentTrackerState = trackerState ?? existing?.trackerState;
      const currentAttempt = attempt ?? existing?.attempt;
      return markRunningMutation({
        issueId,
        identifier: identifier ?? resolveIssueIdentifier(state, issueId),
        fiber,
        startedAt: existing?.startedAt ?? now,
        turnCount: existing?.turnCount ?? 0,
        lastActivityAt: now,
        ...(currentAttempt === undefined ? {} : { attempt: currentAttempt }),
        ...(currentTrackerState === undefined ? {} : { trackerState: currentTrackerState }),
      })(state);
    }),
  markRetryQueued: (issueId, attempt, error, options) =>
    Ref.update(ref, (state) =>
      markRetryQueuedMutation({
        issueId,
        identifier: options?.identifier ?? resolveIssueIdentifier(state, issueId),
        attempt,
        dueAt: options?.dueAt ?? Date.now(),
        error,
      })(state),
    ),
  takeDueRetries: (now) => Ref.modify(ref, takeDueRetriesMutation(now)),
  releaseIssue: (issueId) => Ref.update(ref, releaseIssueMutation(issueId)),
  updateActivity: (issueId) => Ref.update(ref, updateActivityMutation(issueId)),
  updateTrackerState: (issueId, trackerState) =>
    Ref.update(ref, updateTrackerStateMutation(issueId, trackerState)),
  recordTurn: (issueId, trackerState) => Ref.update(ref, recordTurnMutation(issueId, trackerState)),
  incrementTokens: (usage) => Ref.update(ref, incrementTokensMutation(usage)),
  recordRuntimeConfig: (config) => Ref.update(ref, recordRuntimeConfigMutation(config)),
  recordPoll: (lastPollAt) => Ref.update(ref, recordPollMutation(lastPollAt)),
  getState: () =>
    Ref.get(ref).pipe(
      Effect.map((state) => ({
        running: new Map(state.running),
        retryQueue: [...state.retryQueue],
        tokenTotals: { ...state.tokenTotals },
        runtimeConfig: { ...state.runtimeConfig },
        lastPollAt: state.lastPollAt,
        claims: new Map(state.claims ?? []),
        identifiers: new Map(state.identifiers ?? []),
      })),
    ),
  getSnapshot: () => Ref.get(ref).pipe(Effect.map((state) => getSnapshot(state))),
});

export const OrchestratorStateRefLive: Layer.Layer<OrchestratorStateRef> = Layer.effect(
  OrchestratorStateRef,
  Ref.make(initialOrchestratorState).pipe(Effect.map(makeOrchestratorStateRef)),
);
