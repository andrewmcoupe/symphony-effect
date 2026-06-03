import { Effect, Fiber, Option, Ref } from "effect";
import { describe, expect, it } from "vitest";
import type { TrackerClient } from "../tracker/index.js";
import { RequestFailed } from "../tracker/index.js";
import type {
  HookExecutionResult,
  HookExecutorService,
  WorkspaceManagerService,
} from "../workspace/index.js";
import { makeReconciler, type ReconcilerConfigValue } from "./reconciliation.js";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./state/index.js";
import type { WorkerError } from "./state/types.js";

const baseConfig: ReconcilerConfigValue = {
  activeStates: ["Todo", "In Progress"],
  terminalStates: ["Done", "Cancelled"],
  hooks: { timeout_ms: 1_000, before_remove: "cleanup" },
  stallTimeoutMs: 300_000,
  maxRetryBackoffMs: 300_000,
};

const hookResult: HookExecutionResult = { exitCode: 0, stdout: "", stderr: "" };

const makeTracker = (overrides: Partial<TrackerClient> = {}): TrackerClient => ({
  fetchCandidateIssues: () => Effect.succeed([]),
  fetchIssuesByStates: () => Effect.succeed([]),
  fetchIssueStatesByIds: () => Effect.succeed(new Map()),
  ...overrides,
});

const makeWorkspaceManager = (removed: string[] = []): WorkspaceManagerService => ({
  getWorkspacePath: (identifier) => Effect.succeed(`/tmp/symphony/${identifier}`),
  listWorkspaceDirectories: () => Effect.succeed([]),
  ensureWorkspace: (identifier) =>
    Effect.succeed({ path: `/tmp/symphony/${identifier}`, createdNow: false }),
  removeWorkspace: (identifier) =>
    Effect.sync(() => {
      removed.push(identifier);
    }),
});

const makeHookExecutor = (hookCalls: string[] = []): HookExecutorService => ({
  executeHook: () => Effect.succeed(hookResult),
  executeLifecycleHook: ({ hookName }) =>
    Effect.sync(() => {
      hookCalls.push(hookName);
      return Option.some(hookResult);
    }),
});

const runWithReconciler = <A, E>(effect: Effect.Effect<A, E, OrchestratorStateRef>) =>
  Effect.runPromise(effect.pipe(Effect.provide(OrchestratorStateRefLive)));

const forkInterruptibleWorker = (interruptedRef: Ref.Ref<boolean>) =>
  Effect.forkDaemon(
    Effect.never.pipe(Effect.onInterrupt(() => Ref.set(interruptedRef, true))),
  ).pipe(Effect.map((fiber) => fiber as Fiber.RuntimeFiber<void, WorkerError>));

const forkWorker = () =>
  Effect.forkDaemon(Effect.never).pipe(
    Effect.map((fiber) => fiber as Fiber.RuntimeFiber<void, WorkerError>),
  );

describe("Reconciler", () => {
  it("detects stalled running issues, interrupts them, and schedules retry", async () => {
    const result = await runWithReconciler(
      Effect.gen(function* () {
        const stateRef = yield* OrchestratorStateRef;
        const fiber = yield* forkWorker();

        yield* stateRef.markRunning("issue-1", fiber, "ABC-1", "Todo", 2);

        const reconciler = makeReconciler({
          config: { ...baseConfig, stallTimeoutMs: 10 },
          hookExecutor: makeHookExecutor(),
          now: () => Date.now() + 11,
          stateRef,
          tracker: makeTracker(),
          workspaceManager: makeWorkspaceManager(),
        });

        yield* reconciler.reconcile();
        const snapshot = yield* stateRef.getSnapshot();
        return { snapshot };
      }),
    );

    expect(result.snapshot.running).toEqual([]);
    expect(result.snapshot.retryQueue).toEqual([
      {
        issueId: "issue-1",
        identifier: "ABC-1",
        attempt: 3,
        dueAt: expect.any(Number),
        error: "Stalled",
      },
    ]);
  });

  it("skips stall detection when timeout is disabled", async () => {
    const result = await runWithReconciler(
      Effect.gen(function* () {
        const stateRef = yield* OrchestratorStateRef;
        const interruptedRef = yield* Ref.make(false);
        const fiber = yield* forkInterruptibleWorker(interruptedRef);

        yield* stateRef.markRunning("issue-1", fiber, "ABC-1", "Todo");

        const reconciler = makeReconciler({
          config: { ...baseConfig, stallTimeoutMs: 0 },
          hookExecutor: makeHookExecutor(),
          now: () => Date.now() + 1_000_000,
          stateRef,
          tracker: makeTracker({
            fetchIssueStatesByIds: () => Effect.succeed(new Map([["issue-1", "Todo"]])),
          }),
          workspaceManager: makeWorkspaceManager(),
        });

        yield* reconciler.reconcile();
        const snapshot = yield* stateRef.getSnapshot();
        const interrupted = yield* Ref.get(interruptedRef);
        yield* Fiber.interrupt(fiber);
        return { snapshot, interrupted };
      }),
    );

    expect(result.interrupted).toBe(false);
    expect(result.snapshot.running).toHaveLength(1);
    expect(result.snapshot.retryQueue).toEqual([]);
  });

  it("interrupts terminal issues, runs cleanup, removes workspace, and releases state", async () => {
    const result = await runWithReconciler(
      Effect.gen(function* () {
        const stateRef = yield* OrchestratorStateRef;
        const fiber = yield* forkWorker();
        const hookCalls: string[] = [];
        const removed: string[] = [];

        yield* stateRef.markRunning("issue-1", fiber, "ABC-1", "Todo");

        const reconciler = makeReconciler({
          config: baseConfig,
          hookExecutor: makeHookExecutor(hookCalls),
          now: () => Date.now(),
          stateRef,
          tracker: makeTracker({
            fetchIssueStatesByIds: () => Effect.succeed(new Map([["issue-1", "Done"]])),
          }),
          workspaceManager: makeWorkspaceManager(removed),
        });

        yield* reconciler.reconcile();
        const snapshot = yield* stateRef.getSnapshot();
        return { snapshot, hookCalls, removed };
      }),
    );

    expect(result.hookCalls).toEqual(["before_remove"]);
    expect(result.removed).toEqual(["ABC-1"]);
    expect(result.snapshot.running).toEqual([]);
    expect(result.snapshot.claims).toEqual([]);
  });

  it("updates cached tracker state when issue remains active", async () => {
    const snapshot = await runWithReconciler(
      Effect.gen(function* () {
        const stateRef = yield* OrchestratorStateRef;
        const interruptedRef = yield* Ref.make(false);
        const fiber = yield* forkInterruptibleWorker(interruptedRef);

        yield* stateRef.markRunning("issue-1", fiber, "ABC-1", "Todo");

        const reconciler = makeReconciler({
          config: baseConfig,
          hookExecutor: makeHookExecutor(),
          now: () => Date.now(),
          stateRef,
          tracker: makeTracker({
            fetchIssueStatesByIds: () => Effect.succeed(new Map([["issue-1", "In Progress"]])),
          }),
          workspaceManager: makeWorkspaceManager(),
        });

        yield* reconciler.reconcile();
        yield* Fiber.interrupt(fiber);
        return yield* stateRef.getSnapshot();
      }),
    );

    expect(snapshot.running[0]).toMatchObject({
      issueId: "issue-1",
      trackerState: "In Progress",
      turnCount: 0,
    });
  });

  it("keeps workers running when state refresh fails", async () => {
    const result = await runWithReconciler(
      Effect.gen(function* () {
        const stateRef = yield* OrchestratorStateRef;
        const interruptedRef = yield* Ref.make(false);
        const fiber = yield* forkInterruptibleWorker(interruptedRef);

        yield* stateRef.markRunning("issue-1", fiber, "ABC-1", "Todo");

        const reconciler = makeReconciler({
          config: { ...baseConfig, stallTimeoutMs: 0 },
          hookExecutor: makeHookExecutor(),
          now: () => Date.now(),
          stateRef,
          tracker: makeTracker({
            fetchIssueStatesByIds: () =>
              Effect.fail(
                new RequestFailed({
                  endpoint: "https://linear.example/graphql",
                  reason: "network down",
                }),
              ),
          }),
          workspaceManager: makeWorkspaceManager(),
        });

        yield* reconciler.reconcile();
        const snapshot = yield* stateRef.getSnapshot();
        const interrupted = yield* Ref.get(interruptedRef);
        yield* Fiber.interrupt(fiber);
        return { snapshot, interrupted };
      }),
    );

    expect(result.interrupted).toBe(false);
    expect(result.snapshot.running).toHaveLength(1);
    expect(result.snapshot.retryQueue).toEqual([]);
  });
});
