import { Context, Effect, Fiber, Layer, PubSub, Queue, Ref, Scope } from "effect";
import { makeDomainEventPubSub, type DomainEvent } from "./events.js";
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
  requestShutdownMutation,
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
  readonly events: PubSub.PubSub<DomainEvent>;
  readonly subscribe: () => Effect.Effect<Queue.Dequeue<DomainEvent>, never, Scope.Scope>;
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
  readonly recordTurn: (
    issueId: string,
    trackerState?: string,
    output?: string,
  ) => Effect.Effect<void>;
  readonly incrementTokens: (usage: TokenUsageDelta) => Effect.Effect<void>;
  readonly recordRuntimeConfig: (config: RuntimeConfigSnapshot) => Effect.Effect<void>;
  readonly recordPoll: (lastPollAt?: number) => Effect.Effect<void>;
  readonly requestShutdown: () => Effect.Effect<void>;
  readonly isShutdownRequested: () => Effect.Effect<boolean>;
  readonly getState: () => Effect.Effect<OrchestratorState>;
  readonly getSnapshot: () => Effect.Effect<OrchestratorSnapshot>;
}

export const OrchestratorStateRef = Context.GenericTag<OrchestratorStateRef>(
  "symphony/OrchestratorStateRef",
);

const publishEvent = (
  events: PubSub.PubSub<DomainEvent>,
  event: DomainEvent | undefined,
): Effect.Effect<void> =>
  event === undefined ? Effect.void : PubSub.publish(events, event).pipe(Effect.asVoid);

const issueStateChanged = (state: OrchestratorState, issueId: string): DomainEvent => ({
  _tag: "IssueStateChanged",
  issueId,
  identifier: resolveIssueIdentifier(state, issueId),
});

export const makeOrchestratorStateRef = (
  ref: Ref.Ref<OrchestratorState>,
  events: PubSub.PubSub<DomainEvent>,
): OrchestratorStateRef => ({
  events,
  subscribe: () => PubSub.subscribe(events),
  claimIssue: (issueId, identifier) =>
    Ref.modify(ref, (state) => {
      const next = claimIssueMutation(issueId, identifier)(state);
      return [issueStateChanged(next, issueId), next];
    }).pipe(Effect.flatMap((event) => publishEvent(events, event))),
  markRunning: (issueId, fiber, identifier, trackerState, attempt) =>
    Ref.modify(ref, (state) => {
      const now = Date.now();
      const existing = state.running.get(issueId);
      const currentTrackerState = trackerState ?? existing?.trackerState;
      const currentAttempt = attempt ?? existing?.attempt;
      const next = markRunningMutation({
        issueId,
        identifier: identifier ?? resolveIssueIdentifier(state, issueId),
        fiber,
        startedAt: existing?.startedAt ?? now,
        turnCount: existing?.turnCount ?? 0,
        lastActivityAt: now,
        ...(currentAttempt === undefined ? {} : { attempt: currentAttempt }),
        ...(currentTrackerState === undefined ? {} : { trackerState: currentTrackerState }),
      })(state);
      return [issueStateChanged(next, issueId), next];
    }).pipe(Effect.flatMap((event) => publishEvent(events, event))),
  markRetryQueued: (issueId, attempt, error, options) =>
    Ref.modify(ref, (state) => {
      const next = markRetryQueuedMutation({
        issueId,
        identifier: options?.identifier ?? resolveIssueIdentifier(state, issueId),
        attempt,
        dueAt: options?.dueAt ?? Date.now(),
        error,
      })(state);
      return [issueStateChanged(next, issueId), next];
    }).pipe(Effect.flatMap((event) => publishEvent(events, event))),
  takeDueRetries: (now) =>
    Ref.modify(ref, (state) => {
      const [due, next] = takeDueRetriesMutation(now)(state);
      const eventEntries = due.map((entry) => ({
        _tag: "IssueStateChanged" as const,
        issueId: entry.issueId,
        identifier: entry.identifier,
      }));
      return [{ due, eventEntries }, next];
    }).pipe(
      Effect.tap(({ eventEntries }) =>
        Effect.forEach(eventEntries, (event) => publishEvent(events, event), {
          discard: true,
        }),
      ),
      Effect.map(({ due }) => due),
    ),
  releaseIssue: (issueId) =>
    Ref.modify(ref, (state) => {
      const event = issueStateChanged(state, issueId);
      const next = releaseIssueMutation(issueId)(state);
      return [event, next];
    }).pipe(Effect.flatMap((event) => publishEvent(events, event))),
  updateActivity: (issueId) => Ref.update(ref, updateActivityMutation(issueId)),
  updateTrackerState: (issueId, trackerState) =>
    Ref.modify(ref, (state) => {
      const next = updateTrackerStateMutation(issueId, trackerState)(state);
      if (next === state) return [undefined, next];
      return [issueStateChanged(next, issueId), next];
    }).pipe(Effect.flatMap((event) => publishEvent(events, event))),
  recordTurn: (issueId, trackerState, output) =>
    Ref.modify(ref, (state) => {
      const next = recordTurnMutation(issueId, trackerState, output)(state);
      if (next === state) return [undefined, next];
      return [
        {
          _tag: "TurnRecorded" as const,
          issueId,
          identifier: resolveIssueIdentifier(next, issueId),
        },
        next,
      ];
    }).pipe(Effect.flatMap((event) => publishEvent(events, event))),
  incrementTokens: (usage) => Ref.update(ref, incrementTokensMutation(usage)),
  recordRuntimeConfig: (config) => Ref.update(ref, recordRuntimeConfigMutation(config)),
  recordPoll: (lastPollAt) => Ref.update(ref, recordPollMutation(lastPollAt)),
  requestShutdown: () => Ref.update(ref, requestShutdownMutation),
  isShutdownRequested: () => Ref.get(ref).pipe(Effect.map((state) => state.shutdownRequested)),
  getState: () =>
    Ref.get(ref).pipe(
      Effect.map((state) => ({
        running: new Map(state.running),
        retryQueue: [...state.retryQueue],
        agentOutputs: new Map(state.agentOutputs),
        tokenTotals: { ...state.tokenTotals },
        runtimeConfig: { ...state.runtimeConfig },
        lastPollAt: state.lastPollAt,
        shutdownRequested: state.shutdownRequested,
        claims: new Map(state.claims ?? []),
        identifiers: new Map(state.identifiers ?? []),
      })),
    ),
  getSnapshot: () => Ref.get(ref).pipe(Effect.map((state) => getSnapshot(state))),
});

export const OrchestratorStateRefLive: Layer.Layer<OrchestratorStateRef> = Layer.effect(
  OrchestratorStateRef,
  Effect.all([Ref.make(initialOrchestratorState), makeDomainEventPubSub]).pipe(
    Effect.map(([ref, events]) => makeOrchestratorStateRef(ref, events)),
  ),
);
