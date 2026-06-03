import { Context, Effect, Layer, Schedule } from "effect";
import type { WorkflowConfig } from "../config/index.js";
import { OrchestratorStateRef, type RetryEntry } from "./state/index.js";

const BASE_RETRY_DELAY_MS = 10_000;
const CONTINUATION_DELAY_MS = 1_000;
const CONTINUATION_ATTEMPT = 0;
const CONTINUATION_ERROR = "continuation";

export const failureRetrySchedule = Schedule.exponential(BASE_RETRY_DELAY_MS);

export interface RetryScheduler {
  readonly calculateDelay: (attempt: number) => number;
  readonly scheduleRetry: (
    issueId: string,
    identifier: string,
    attempt: number,
    error: string,
  ) => Effect.Effect<void>;
  readonly scheduleContinuation: (issueId: string, identifier: string) => Effect.Effect<void>;
  readonly getDueRetries: () => Effect.Effect<ReadonlyArray<RetryEntry>>;
}

export interface RetrySchedulerConfigValue {
  readonly max_retry_backoff_ms: WorkflowConfig["agent"]["max_retry_backoff_ms"];
}

export const RetryScheduler = Context.GenericTag<RetryScheduler>("symphony/RetryScheduler");

export const RetrySchedulerConfig = Context.GenericTag<RetrySchedulerConfigValue>(
  "symphony/RetrySchedulerConfig",
);

const positiveAttempt = (attempt: number): number => Math.max(1, Math.floor(attempt));

export const makeRetryScheduler = ({
  config,
  now,
  stateRef,
}: {
  readonly config: RetrySchedulerConfigValue;
  readonly now: () => number;
  readonly stateRef: OrchestratorStateRef;
}): RetryScheduler => {
  const calculateDelay = (attempt: number): number => {
    const exponent = positiveAttempt(attempt) - 1;
    const delay = BASE_RETRY_DELAY_MS * 2 ** exponent;
    return Math.min(delay, config.max_retry_backoff_ms);
  };

  const scheduleRetry = (
    issueId: string,
    identifier: string,
    attempt: number,
    error: string,
  ): Effect.Effect<void> => {
    const delay = calculateDelay(attempt);
    return stateRef.markRetryQueued(issueId, attempt, error, {
      identifier,
      dueAt: now() + delay,
    });
  };

  const scheduleContinuation = (issueId: string, identifier: string): Effect.Effect<void> =>
    stateRef.markRetryQueued(issueId, CONTINUATION_ATTEMPT, CONTINUATION_ERROR, {
      identifier,
      dueAt: now() + CONTINUATION_DELAY_MS,
    });

  return {
    calculateDelay,
    scheduleRetry,
    scheduleContinuation,
    getDueRetries: () => stateRef.takeDueRetries(now()),
  };
};

export const RetrySchedulerLive: Layer.Layer<
  RetryScheduler,
  never,
  RetrySchedulerConfigValue | OrchestratorStateRef
> = Layer.effect(
  RetryScheduler,
  Effect.gen(function* () {
    const config = yield* RetrySchedulerConfig;
    const stateRef = yield* OrchestratorStateRef;
    return makeRetryScheduler({ config, now: Date.now, stateRef });
  }),
);

export const makeRetrySchedulerLive = (
  config: RetrySchedulerConfigValue,
): Layer.Layer<RetryScheduler, never, OrchestratorStateRef> =>
  RetrySchedulerLive.pipe(Layer.provide(Layer.succeed(RetrySchedulerConfig, config)));
