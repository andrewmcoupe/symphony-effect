import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeRetryScheduler, RetryScheduler, type RetrySchedulerConfigValue } from "./retry.js";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./state/index.js";

const baseConfig: RetrySchedulerConfigValue = {
  max_retry_backoff_ms: 300_000,
};

const runWithRetry = <A, E>(
  effect: Effect.Effect<A, E, RetryScheduler | OrchestratorStateRef>,
  config = baseConfig,
  now = () => 1_000,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const stateRef = yield* OrchestratorStateRef;
      const retry = makeRetryScheduler({ config, now, stateRef });
      return yield* effect.pipe(Effect.provideService(RetryScheduler, retry));
    }).pipe(Effect.provide(OrchestratorStateRefLive)),
  );

describe("RetryScheduler", () => {
  it("calculates exponential failure retry delays", async () => {
    const delays = await runWithRetry(
      Effect.gen(function* () {
        const retry = yield* RetryScheduler;
        return [1, 2, 3, 4, 5].map((attempt) => retry.calculateDelay(attempt));
      }),
    );

    expect(delays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000]);
  });

  it("caps delay at max_retry_backoff_ms", async () => {
    const delays = await runWithRetry(
      Effect.gen(function* () {
        const retry = yield* RetryScheduler;
        return [1, 2, 3, 4].map((attempt) => retry.calculateDelay(attempt));
      }),
      { max_retry_backoff_ms: 25_000 },
    );

    expect(delays).toEqual([10_000, 20_000, 25_000, 25_000]);
  });

  it("schedules retries and returns only due entries", async () => {
    const result = await runWithRetry(
      Effect.gen(function* () {
        const retry = yield* RetryScheduler;
        const state = yield* OrchestratorStateRef;

        yield* retry.scheduleRetry("issue-1", "ABC-1", 1, "first failure");
        yield* retry.scheduleRetry("issue-2", "ABC-2", 2, "second failure");

        const beforeDue = yield* state.getSnapshot();
        const due = yield* retry.getDueRetries();
        const afterDue = yield* state.getSnapshot();

        return { beforeDue, due, afterDue };
      }),
      baseConfig,
      () => 100_000,
    );

    expect(result.beforeDue.retryQueue).toEqual([
      {
        issueId: "issue-1",
        identifier: "ABC-1",
        attempt: 1,
        dueAt: 110_000,
        error: "first failure",
      },
      {
        issueId: "issue-2",
        identifier: "ABC-2",
        attempt: 2,
        dueAt: 120_000,
        error: "second failure",
      },
    ]);
    expect(result.due).toEqual([]);
    expect(result.afterDue.retryQueue).toHaveLength(2);
  });

  it("removes due retries from the queue", async () => {
    let currentTime = 100_000;

    const result = await runWithRetry(
      Effect.gen(function* () {
        const retry = yield* RetryScheduler;
        const state = yield* OrchestratorStateRef;

        yield* retry.scheduleRetry("issue-1", "ABC-1", 1, "first failure");
        yield* retry.scheduleRetry("issue-2", "ABC-2", 2, "second failure");

        currentTime = 115_000;
        const due = yield* retry.getDueRetries();
        const snapshot = yield* state.getSnapshot();

        return { due, snapshot };
      }),
      baseConfig,
      () => currentTime,
    );

    expect(result.due).toEqual([
      {
        issueId: "issue-1",
        identifier: "ABC-1",
        attempt: 1,
        dueAt: 110_000,
        error: "first failure",
      },
    ]);
    expect(result.snapshot.retryQueue).toEqual([
      {
        issueId: "issue-2",
        identifier: "ABC-2",
        attempt: 2,
        dueAt: 120_000,
        error: "second failure",
      },
    ]);
    expect(result.snapshot.claims).toEqual([
      {
        issueId: "issue-2",
        _tag: "RetryQueued",
        identifier: "ABC-2",
        attempt: 2,
        dueAt: 120_000,
        error: "second failure",
      },
    ]);
  });

  it("schedules continuations with a short delay", async () => {
    const snapshot = await runWithRetry(
      Effect.gen(function* () {
        const retry = yield* RetryScheduler;
        const state = yield* OrchestratorStateRef;

        yield* retry.scheduleContinuation("issue-1", "ABC-1");
        return yield* state.getSnapshot();
      }),
      baseConfig,
      () => 50_000,
    );

    expect(snapshot.retryQueue).toEqual([
      {
        issueId: "issue-1",
        identifier: "ABC-1",
        attempt: 0,
        dueAt: 51_000,
        error: "continuation",
      },
    ]);
    expect(snapshot.claims).toEqual([
      {
        issueId: "issue-1",
        _tag: "RetryQueued",
        identifier: "ABC-1",
        attempt: 0,
        dueAt: 51_000,
        error: "continuation",
      },
    ]);
  });
});
