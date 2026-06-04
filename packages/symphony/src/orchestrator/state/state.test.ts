import { Effect, Fiber, Option, Queue } from "effect";
import { describe, expect, it } from "vitest";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./ref.js";
import type { DomainEvent } from "./events.js";
import type { WorkerError } from "./types.js";

const runWithState = <A, E>(effect: Effect.Effect<A, E, OrchestratorStateRef>) =>
  Effect.runPromise(effect.pipe(Effect.provide(OrchestratorStateRefLive)));

const makeFiber = (): Fiber.RuntimeFiber<void, WorkerError> =>
  Effect.runFork(Effect.void) as Fiber.RuntimeFiber<void, WorkerError>;

const takeEvent = (queue: Queue.Dequeue<DomainEvent>) => Queue.take(queue);

const pollEvent = (queue: Queue.Dequeue<DomainEvent>) => Queue.poll(queue);

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

  it("records completed turns, agent output, and latest activity", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRunning("issue-123", makeFiber(), "ABC-123", "Todo");
        const before = yield* state.getSnapshot();
        yield* Effect.sleep("5 millis");
        yield* state.recordTurn("issue-123", "In Progress", "Implemented the fix.");
        yield* state.recordTurn("missing");
        const after = yield* state.getSnapshot();

        return { before, after };
      }),
    );

    expect(snapshot.after.running[0]).toMatchObject({
      issueId: "issue-123",
      turnCount: 1,
      trackerState: "In Progress",
      latestAgentOutput: {
        issueId: "issue-123",
        identifier: "ABC-123",
        turnNumber: 1,
        recordedAt: expect.any(Number),
        output: "Implemented the fix.",
      },
    });
    expect(snapshot.after.agentOutputs).toEqual([
      {
        issueId: "issue-123",
        identifier: "ABC-123",
        turnNumber: 1,
        recordedAt: expect.any(Number),
        output: "Implemented the fix.",
      },
    ]);
    expect(snapshot.after.running[0]?.lastActivityAt).toBeGreaterThanOrEqual(
      snapshot.before.running[0]?.lastActivityAt ?? 0,
    );
  });

  it("keeps only recent bounded agent output entries", async () => {
    const snapshot = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        yield* state.markRunning("issue-123", makeFiber(), "ABC-123");

        for (const output of ["one", "two", "three", "four", "five", "six"]) {
          yield* state.recordTurn("issue-123", undefined, output);
        }

        return yield* state.getSnapshot();
      }),
    );

    expect(snapshot.agentOutputs.map((entry) => entry.output)).toEqual([
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
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

  it("records shutdown requests", async () => {
    const result = await runWithState(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        const before = yield* state.isShutdownRequested();
        yield* state.requestShutdown();
        const after = yield* state.isShutdownRequested();
        const currentSnapshot = yield* state.getSnapshot();

        return { after, before, snapshot: currentSnapshot };
      }),
    );

    expect(result.before).toBe(false);
    expect(result.after).toBe(true);
    expect(result.snapshot.shutdownRequested).toBe(true);
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

  it("publishes IssueStateChanged events for issue state mutations", async () => {
    const events = await runWithState(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* OrchestratorStateRef;
          const subscription = yield* state.subscribe();
          const emitted: DomainEvent[] = [];

          yield* state.claimIssue("issue-123", "ABC-123");
          emitted.push(yield* takeEvent(subscription));

          yield* state.markRunning("issue-123", makeFiber());
          emitted.push(yield* takeEvent(subscription));

          yield* state.markRetryQueued("issue-123", 2, "failed", { dueAt: 200 });
          emitted.push(yield* takeEvent(subscription));

          yield* state.markRunning("issue-123", makeFiber());
          emitted.push(yield* takeEvent(subscription));

          yield* state.updateTrackerState("issue-123", "In Progress");
          emitted.push(yield* takeEvent(subscription));

          yield* state.releaseIssue("issue-123");
          emitted.push(yield* takeEvent(subscription));

          return emitted;
        }),
      ),
    );

    expect(events).toEqual([
      { _tag: "IssueStateChanged", issueId: "issue-123", identifier: "ABC-123" },
      { _tag: "IssueStateChanged", issueId: "issue-123", identifier: "ABC-123" },
      { _tag: "IssueStateChanged", issueId: "issue-123", identifier: "ABC-123" },
      { _tag: "IssueStateChanged", issueId: "issue-123", identifier: "ABC-123" },
      { _tag: "IssueStateChanged", issueId: "issue-123", identifier: "ABC-123" },
      { _tag: "IssueStateChanged", issueId: "issue-123", identifier: "ABC-123" },
    ]);
  });

  it("publishes TurnRecorded events for recorded turns", async () => {
    const event = await runWithState(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* OrchestratorStateRef;
          const subscription = yield* state.subscribe();

          yield* state.markRunning("issue-123", makeFiber(), "ABC-123");
          yield* takeEvent(subscription);
          yield* state.recordTurn("issue-123", "In Progress", "Implemented the fix.");
          return yield* takeEvent(subscription);
        }),
      ),
    );

    expect(event).toEqual({
      _tag: "TurnRecorded",
      issueId: "issue-123",
      identifier: "ABC-123",
    });
  });

  it("publishes one IssueStateChanged event per due retry", async () => {
    const events = await runWithState(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* OrchestratorStateRef;
          const subscription = yield* state.subscribe();

          yield* state.markRetryQueued("issue-1", 1, "first", {
            dueAt: 100,
            identifier: "ABC-1",
          });
          yield* takeEvent(subscription);
          yield* state.markRetryQueued("issue-2", 2, "second", {
            dueAt: 100,
            identifier: "ABC-2",
          });
          yield* takeEvent(subscription);

          yield* state.takeDueRetries(100);
          return [yield* takeEvent(subscription), yield* takeEvent(subscription)];
        }),
      ),
    );

    expect(events).toEqual([
      { _tag: "IssueStateChanged", issueId: "issue-1", identifier: "ABC-1" },
      { _tag: "IssueStateChanged", issueId: "issue-2", identifier: "ABC-2" },
    ]);
  });

  it("does not publish events for silent mutations", async () => {
    const event = await runWithState(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* OrchestratorStateRef;
          const subscription = yield* state.subscribe();

          yield* state.markRunning("issue-123", makeFiber(), "ABC-123");
          yield* takeEvent(subscription);
          yield* state.incrementTokens({ inputTokens: 1 });
          yield* state.updateActivity("issue-123");
          yield* state.recordPoll(123);

          return yield* pollEvent(subscription);
        }),
      ),
    );

    expect(Option.isNone(event)).toBe(true);
  });

  it("uses a sliding PubSub so non-draining subscribers do not block publishers", async () => {
    const published = await runWithState(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* OrchestratorStateRef;
          yield* state.subscribe();

          for (let index = 0; index < 128; index += 1) {
            yield* state.claimIssue(`issue-${index}`, `ABC-${index}`);
          }

          return 128;
        }),
      ),
    );

    expect(published).toBe(128);
  });
});
