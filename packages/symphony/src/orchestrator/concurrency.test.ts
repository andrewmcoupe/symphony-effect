import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  ConcurrencyController,
  type ConcurrencyController as ConcurrencyControllerService,
  type ConcurrencyControllerConfigValue,
  makeConcurrencyControllerLive,
} from "./concurrency.js";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./state/index.js";
import type { WorkerError } from "./state/types.js";

const baseAgentConfig: ConcurrencyControllerConfigValue = {
  max_concurrent_agents: 2,
  max_turns: 20,
  max_retry_backoff_ms: 300_000,
};

const runWithConcurrency = <A, E>(
  effect: Effect.Effect<A, E, ConcurrencyControllerService | OrchestratorStateRef>,
  config = baseAgentConfig,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(makeConcurrencyControllerLive(config)),
      Effect.provide(OrchestratorStateRefLive),
    ),
  );

const makeFiber = (): Fiber.RuntimeFiber<void, WorkerError> =>
  Effect.runFork(Effect.void) as Fiber.RuntimeFiber<void, WorkerError>;

describe("ConcurrencyController", () => {
  it("enforces the global concurrency limit", async () => {
    const result = await runWithConcurrency(
      Effect.scoped(
        Effect.gen(function* () {
          const concurrency = yield* ConcurrencyController;

          const before = yield* concurrency.canDispatch("Todo");
          yield* concurrency.acquireSlot();
          const afterFirst = yield* concurrency.canDispatch("Todo");
          yield* concurrency.acquireSlot();
          const atLimit = yield* concurrency.canDispatch("Todo");
          const counts = yield* concurrency.getCurrentCounts();

          return { before, afterFirst, atLimit, counts };
        }),
      ),
    );

    expect(result.before).toBe(true);
    expect(result.afterFirst).toBe(true);
    expect(result.atLimit).toBe(false);
    expect(result.counts.global).toEqual({ used: 2, max: 2 });
  });

  it("enforces per-state limits from the running map", async () => {
    const result = await runWithConcurrency(
      Effect.gen(function* () {
        const concurrency = yield* ConcurrencyController;
        const state = yield* OrchestratorStateRef;

        yield* state.markRunning("issue-1", makeFiber(), "ABC-1", "Todo");

        const canDispatchTodo = yield* concurrency.canDispatch("todo");
        const canDispatchInProgress = yield* concurrency.canDispatch("In Progress");
        const counts = yield* concurrency.getCurrentCounts();

        return { canDispatchTodo, canDispatchInProgress, counts };
      }),
      {
        ...baseAgentConfig,
        max_concurrent_agents_by_state: { Todo: 1, "In Progress": 2 },
      },
    );

    expect(result.canDispatchTodo).toBe(false);
    expect(result.canDispatchInProgress).toBe(true);
    expect(result.counts.byState.get("todo")).toEqual({ used: 1, max: 1 });
    expect(result.counts.byState.get("in progress")).toEqual({ used: 0, max: 2 });
  });

  it("combines global and per-state limits", async () => {
    const result = await runWithConcurrency(
      Effect.scoped(
        Effect.gen(function* () {
          const concurrency = yield* ConcurrencyController;
          const state = yield* OrchestratorStateRef;

          yield* state.markRunning("issue-1", makeFiber(), "ABC-1", "Todo");
          yield* concurrency.acquireSlot();

          const todoBlockedByState = yield* concurrency.canDispatch("Todo");
          const inProgressAllowed = yield* concurrency.canDispatch("In Progress");

          yield* concurrency.acquireSlot();
          const inProgressBlockedByGlobal = yield* concurrency.canDispatch("In Progress");

          return { todoBlockedByState, inProgressAllowed, inProgressBlockedByGlobal };
        }),
      ),
      {
        ...baseAgentConfig,
        max_concurrent_agents_by_state: { Todo: 1, "In Progress": 2 },
      },
    );

    expect(result.todoBlockedByState).toBe(false);
    expect(result.inProgressAllowed).toBe(true);
    expect(result.inProgressBlockedByGlobal).toBe(false);
  });

  it("releases slots manually and when the scope closes", async () => {
    const result = await runWithConcurrency(
      Effect.gen(function* () {
        const concurrency = yield* ConcurrencyController;

        const scoped = yield* Effect.scoped(
          Effect.gen(function* () {
            const release = yield* concurrency.acquireSlot();
            const atLimit = yield* concurrency.canDispatch("Todo");

            yield* release();
            const afterManualRelease = yield* concurrency.canDispatch("Todo");
            const afterManualCounts = yield* concurrency.getCurrentCounts();

            yield* release();
            const afterSecondReleaseCounts = yield* concurrency.getCurrentCounts();

            return { atLimit, afterManualRelease, afterManualCounts, afterSecondReleaseCounts };
          }),
        );

        const afterScopeCounts = yield* concurrency.getCurrentCounts();
        return { ...scoped, afterScopeCounts };
      }),
      { ...baseAgentConfig, max_concurrent_agents: 1 },
    );

    expect(result.atLimit).toBe(false);
    expect(result.afterManualRelease).toBe(true);
    expect(result.afterManualCounts.global).toEqual({ used: 0, max: 1 });
    expect(result.afterSecondReleaseCounts.global).toEqual({ used: 0, max: 1 });
    expect(result.afterScopeCounts.global).toEqual({ used: 0, max: 1 });
  });
});
