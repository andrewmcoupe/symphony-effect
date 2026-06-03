import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./ref.js";
import type { WorkerError } from "./types.js";

const runWithState = <A, E>(effect: Effect.Effect<A, E, OrchestratorStateRef>) =>
  Effect.runPromise(effect.pipe(Effect.provide(OrchestratorStateRefLive)));

const makeFiber = (): Fiber.RuntimeFiber<void, WorkerError> =>
  Effect.runFork(Effect.void) as Fiber.RuntimeFiber<void, WorkerError>;

describe("OrchestratorStateRef", () => {
  it("claims issues and exposes them in the snapshot", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.claimIssue("issue-123", "ABC-123");
        return yield* state.getSnapshot();
      }),
    );

    expect(snapshot.claims).toEqual([
      {
        issueId: "issue-123",
        _tag: "Claimed",
        claimedAt: expect.any(Number),
        identifier: "ABC-123",
      },
    ]);
    expect(snapshot.running).toEqual([]);
    expect(snapshot.retryQueue).toEqual([]);
  });

  it("marks claimed issues as running and preserves their identifier", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.claimIssue("issue-123", "ABC-123");
        yield* state.markRunning("issue-123", makeFiber());
        return yield* state.getSnapshot();
      }),
    );

    expect(snapshot.running).toHaveLength(1);
    expect(snapshot.running[0]).toMatchObject({
      issueId: "issue-123",
      identifier: "ABC-123",
      turnCount: 0,
      startedAt: expect.any(Number),
      elapsedMs: expect.any(Number),
      lastActivityAt: expect.any(Number),
    });
    expect(snapshot.claims).toEqual([
      {
        issueId: "issue-123",
        _tag: "Running",
        identifier: "ABC-123",
        startedAt: expect.any(Number),
        turnCount: 0,
        lastActivityAt: expect.any(Number),
      },
    ]);
  });

  it("updates running activity without changing non-running issues", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRunning("issue-123", makeFiber(), "ABC-123");
        const before = yield* state.getSnapshot();
        yield* Effect.sleep("5 millis");
        yield* state.updateActivity("issue-123");
        yield* state.updateActivity("missing");
        const after = yield* state.getSnapshot();

        return { before, after };
      }),
    );

    expect(snapshot.after.running[0]?.lastActivityAt).toBeGreaterThanOrEqual(
      snapshot.before.running[0]?.lastActivityAt ?? 0,
    );
    expect(snapshot.after.running).toHaveLength(1);
  });

  it("records completed turns and latest activity", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRunning("issue-123", makeFiber(), "ABC-123", "Todo");
        const before = yield* state.getSnapshot();
        yield* Effect.sleep("5 millis");
        yield* state.recordTurn("issue-123", "In Progress");
        yield* state.recordTurn("missing");
        const after = yield* state.getSnapshot();

        return { before, after };
      }),
    );

    expect(snapshot.after.running[0]).toMatchObject({
      issueId: "issue-123",
      turnCount: 1,
      trackerState: "In Progress",
    });
    expect(snapshot.after.running[0]?.lastActivityAt).toBeGreaterThanOrEqual(
      snapshot.before.running[0]?.lastActivityAt ?? 0,
    );
  });

  it("queues retries, removes running state, and sorts by due date", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRunning("issue-123", makeFiber(), "ABC-123");
        yield* state.markRetryQueued("issue-123", 2, "failed", { dueAt: 200 });
        yield* state.markRetryQueued("issue-456", 1, "later", {
          dueAt: 100,
          identifier: "ABC-456",
        });
        return yield* state.getSnapshot();
      }),
    );

    expect(snapshot.running).toEqual([]);
    expect(snapshot.retryQueue).toEqual([
      {
        issueId: "issue-456",
        identifier: "ABC-456",
        attempt: 1,
        dueAt: 100,
        error: "later",
      },
      {
        issueId: "issue-123",
        identifier: "ABC-123",
        attempt: 2,
        dueAt: 200,
        error: "failed",
      },
    ]);
    expect(snapshot.claims).toContainEqual({
      issueId: "issue-123",
      _tag: "RetryQueued",
      identifier: "ABC-123",
      attempt: 2,
      dueAt: 200,
      error: "failed",
    });
  });

  it("releases issues from all state indexes", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRunning("issue-123", makeFiber(), "ABC-123");
        yield* state.markRetryQueued("issue-456", 1, "failed", {
          dueAt: 100,
          identifier: "ABC-456",
        });
        yield* state.releaseIssue("issue-123");
        yield* state.releaseIssue("issue-456");
        return yield* state.getSnapshot();
      }),
    );

    expect(snapshot.running).toEqual([]);
    expect(snapshot.retryQueue).toEqual([]);
    expect(snapshot.claims).toEqual([]);
  });

  it("takes due retries and clears their retry claims", async () => {
    const result = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRetryQueued("issue-1", 1, "first", {
          dueAt: 100,
          identifier: "ABC-1",
        });
        yield* state.markRetryQueued("issue-2", 2, "second", {
          dueAt: 300,
          identifier: "ABC-2",
        });

        const due = yield* state.takeDueRetries(100);
        const snapshot = yield* state.getSnapshot();

        return { due, snapshot };
      }),
    );

    expect(result.due).toEqual([
      {
        issueId: "issue-1",
        identifier: "ABC-1",
        attempt: 1,
        dueAt: 100,
        error: "first",
      },
    ]);
    expect(result.snapshot.retryQueue).toEqual([
      {
        issueId: "issue-2",
        identifier: "ABC-2",
        attempt: 2,
        dueAt: 300,
        error: "second",
      },
    ]);
    expect(result.snapshot.claims).toEqual([
      {
        issueId: "issue-2",
        _tag: "RetryQueued",
        identifier: "ABC-2",
        attempt: 2,
        dueAt: 300,
        error: "second",
      },
    ]);
  });

  it("increments token totals and records poll time", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.incrementTokens({ inputTokens: 10, outputTokens: 5, runtimeSeconds: 3 });
        yield* state.incrementTokens({ inputTokens: 2, outputTokens: 1, totalTokens: 10 });
        yield* state.recordPoll(12345);
        return yield* state.getSnapshot();
      }),
    );

    expect(snapshot.tokenTotals).toEqual({
      inputTokens: 12,
      outputTokens: 6,
      totalTokens: 25,
      runtimeSeconds: 3,
    });
    expect(snapshot.lastPollAt).toBe(12345);
  });

  it("provides an isolated service instance per layer", async () => {
    const program = Effect.gen(function* () {
      const state = yield* OrchestratorStateRef;
      yield* state.claimIssue("issue-123");
      return yield* state.getSnapshot();
    });

    const first = await Effect.runPromise(program.pipe(Effect.provide(OrchestratorStateRefLive)));
    const second = await Effect.runPromise(
      OrchestratorStateRef.pipe(
        Effect.flatMap((state) => state.getSnapshot()),
        Effect.provide(OrchestratorStateRefLive),
      ),
    );

    expect(first.claims).toHaveLength(1);
    expect(second.claims).toHaveLength(0);
  });
});
