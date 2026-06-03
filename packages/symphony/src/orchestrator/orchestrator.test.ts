import { Deferred, Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../agent/index.js";
import { ValidationFailed, type LoadedConfig, type PromptRenderer } from "../config/index.js";
import { ConfigLoader } from "../config/index.js";
import { RequestFailed, type Issue, type TrackerClient } from "../tracker/index.js";
import type {
  HookExecutionResult,
  HookExecutorService,
  WorkspaceManagerService,
} from "../workspace/index.js";
import {
  ConcurrencyController,
  makeConcurrencyControllerLive,
  type ConcurrencyController as ConcurrencyControllerService,
} from "./concurrency.js";
import { makeOrchestrator } from "./orchestrator.js";
import type { Reconciler } from "./reconciliation.js";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./state/index.js";
import type { Worker, WorkerResult } from "./worker.js";

const workflowPath = "/repo/WORKFLOW.md";

const issue = (overrides: Partial<Issue> = {}): Issue => ({
  id: "issue-1",
  identifier: "ABC-1",
  title: "Build polling loop",
  description: "Implement the loop.",
  priority: 1,
  state: "Todo",
  branchName: "abc-1",
  url: "https://linear.app/acme/issue/ABC-1",
  labels: [],
  blockedBy: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

const loadedConfig = (intervalMs = 50): LoadedConfig => ({
  config: {
    tracker: {
      kind: "linear",
      endpoint: "https://linear.example/graphql",
      api_key: "token",
      project_slug: "project",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    },
    polling: { interval_ms: intervalMs },
    workspace: { root: "/tmp/symphony" },
    hooks: { timeout_ms: 1_000 },
    agent: {
      max_concurrent_agents: 1,
      max_turns: 2,
      stall_timeout_ms: 300_000,
      max_retry_backoff_ms: 300_000,
    },
  },
  promptTemplate: "Work on {{ issue.identifier }}",
});

const hookResult: HookExecutionResult = { exitCode: 0, stdout: "", stderr: "" };

const inertAgent: AgentRunner = {
  runTurn: () => Effect.succeed({ success: true, output: "ok", exitCode: 0 }),
};

const inertPromptRenderer: PromptRenderer = {
  render: () => Effect.succeed("prompt"),
};

const inertHookExecutor: HookExecutorService = {
  executeHook: () => Effect.succeed(hookResult),
  executeLifecycleHook: () => Effect.succeed(undefined),
};

const inertWorkspaceManager: WorkspaceManagerService = {
  getWorkspacePath: (identifier) => Effect.succeed(`/tmp/symphony/${identifier}`),
  ensureWorkspace: (identifier) =>
    Effect.succeed({ path: `/tmp/symphony/${identifier}`, createdNow: true }),
  removeWorkspace: () => Effect.void,
};

const runWithOrchestrator = <A, E>(
  build: (services: {
    readonly concurrency: ConcurrencyControllerService;
    readonly stateRef: OrchestratorStateRef;
  }) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const concurrency = yield* ConcurrencyController;
      const stateRef = yield* OrchestratorStateRef;
      return yield* build({ concurrency, stateRef });
    }).pipe(
      Effect.provide(
        makeConcurrencyControllerLive({
          max_concurrent_agents: 1,
          max_turns: 2,
          stall_timeout_ms: 300_000,
          max_retry_backoff_ms: 300_000,
        }),
      ),
      Effect.provide(OrchestratorStateRefLive),
    ),
  );

const makeLoader = (load: ConfigLoader["load"]): ConfigLoader => ({ load }) as ConfigLoader;

const makeTracker = (overrides: Partial<TrackerClient> = {}): TrackerClient => ({
  fetchCandidateIssues: () => Effect.succeed([]),
  fetchIssuesByStates: () => Effect.succeed([]),
  fetchIssueStatesByIds: () => Effect.succeed(new Map()),
  ...overrides,
});

const makeReconciler = (run: () => Effect.Effect<void> = () => Effect.void): Reconciler => ({
  reconcile: run,
});

const makeStaticWorker = (result: Effect.Effect<WorkerResult>): Worker => ({
  runWorker: () => result,
});

describe("Orchestrator", () => {
  it("keeps reconciliation running and skips dispatch when config reload fails", async () => {
    let reconcileCalls = 0;
    let trackerCalls = 0;

    const output = await runWithOrchestrator(({ concurrency, stateRef }) => {
      const orchestrator = makeOrchestrator({
        workflowPath,
        defaultPollingIntervalMs: 123,
        now: () => 42,
        agent: inertAgent,
        concurrency,
        hookExecutor: inertHookExecutor,
        loader: makeLoader(() => Effect.fail(new ValidationFailed({ reason: "bad config" }))),
        promptRenderer: inertPromptRenderer,
        reconciler: makeReconciler(() =>
          Effect.sync(() => {
            reconcileCalls += 1;
          }),
        ),
        stateRef,
        tracker: makeTracker({
          fetchCandidateIssues: () =>
            Effect.sync(() => {
              trackerCalls += 1;
              return [];
            }),
        }),
        workspaceManager: inertWorkspaceManager,
      });

      return Effect.gen(function* () {
        const result = yield* orchestrator.pollOnce();
        const snapshot = yield* stateRef.getSnapshot();
        return { result, snapshot };
      });
    });

    expect(output.result).toEqual({ _tag: "ConfigError", intervalMs: 123 });
    expect(output.snapshot.lastPollAt).toBe(42);
    expect(reconcileCalls).toBe(1);
    expect(trackerCalls).toBe(0);
  });

  it("requeues due retries unchanged when tracker fetch fails", async () => {
    const output = await runWithOrchestrator(({ concurrency, stateRef }) =>
      Effect.gen(function* () {
        yield* stateRef.markRetryQueued("issue-1", 2, "failed before", {
          identifier: "ABC-1",
          dueAt: 100,
        });

        const orchestrator = makeOrchestrator({
          workflowPath,
          now: () => 200,
          agent: inertAgent,
          concurrency,
          hookExecutor: inertHookExecutor,
          loader: makeLoader(() => Effect.succeed(loadedConfig())),
          promptRenderer: inertPromptRenderer,
          reconciler: makeReconciler(),
          stateRef,
          tracker: makeTracker({
            fetchCandidateIssues: () =>
              Effect.fail(
                new RequestFailed({
                  endpoint: "https://linear.example/graphql",
                  reason: "network down",
                }),
              ),
          }),
          workspaceManager: inertWorkspaceManager,
        });

        const result = yield* orchestrator.pollOnce();
        const snapshot = yield* stateRef.getSnapshot();
        return { result, snapshot };
      }),
    );

    expect(output.result).toEqual({ _tag: "TrackerError", intervalMs: 50 });
    expect(output.snapshot.retryQueue).toEqual([
      {
        issueId: "issue-1",
        identifier: "ABC-1",
        attempt: 2,
        dueAt: 100,
        error: "failed before",
      },
    ]);
  });

  it("dispatches due retries before new candidates and schedules continuation on success", async () => {
    const output = await runWithOrchestrator(({ concurrency, stateRef }) =>
      Effect.gen(function* () {
        const releaseWorker = yield* Deferred.make<void>();
        const attempts: Array<number | null> = [];

        yield* stateRef.markRetryQueued("retry-issue", 2, "retry me", {
          identifier: "ABC-2",
          dueAt: 100,
        });

        const retryIssue = issue({
          id: "retry-issue",
          identifier: "ABC-2",
          priority: 9,
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
        });
        const newIssue = issue({
          id: "new-issue",
          identifier: "ABC-1",
          priority: 0,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        });

        const orchestrator = makeOrchestrator({
          workflowPath,
          now: () => 1_000,
          agent: inertAgent,
          concurrency,
          hookExecutor: inertHookExecutor,
          loader: makeLoader(() => Effect.succeed(loadedConfig())),
          promptRenderer: inertPromptRenderer,
          reconciler: makeReconciler(),
          stateRef,
          tracker: makeTracker({
            fetchCandidateIssues: () => Effect.succeed([newIssue, retryIssue]),
          }),
          workspaceManager: inertWorkspaceManager,
          workerFactory: () => ({
            runWorker: (_issue, attempt) => {
              attempts.push(attempt);
              return Deferred.await(releaseWorker).pipe(
                Effect.as({ _tag: "Completed", turnCount: 1 } as const),
              );
            },
          }),
        });

        const result = yield* orchestrator.pollOnce();
        const during = yield* stateRef.getSnapshot();
        yield* Deferred.succeed(releaseWorker, undefined);
        yield* Effect.sleep("10 millis");
        const after = yield* stateRef.getSnapshot();
        return { result, during, after, attempts };
      }),
    );

    expect(output.result).toEqual({ _tag: "Completed", intervalMs: 50 });
    expect(output.attempts).toEqual([2]);
    expect(output.during.running.map((running) => running.identifier)).toEqual(["ABC-2"]);
    expect(output.during.claims.map((claim) => claim.issueId)).not.toContain("new-issue");
    expect(output.after.retryQueue).toEqual([
      {
        issueId: "retry-issue",
        identifier: "ABC-2",
        attempt: 0,
        dueAt: 2_000,
        error: "continuation",
      },
    ]);
  });

  it("uses freshly loaded polling config on each tick", async () => {
    const output = await runWithOrchestrator(({ concurrency, stateRef }) => {
      const configs = [loadedConfig(111), loadedConfig(222)];
      let loadCalls = 0;

      const orchestrator = makeOrchestrator({
        workflowPath,
        agent: inertAgent,
        concurrency,
        hookExecutor: inertHookExecutor,
        loader: makeLoader(() => Effect.succeed(configs[loadCalls++] ?? loadedConfig(333))),
        promptRenderer: inertPromptRenderer,
        reconciler: makeReconciler(),
        stateRef,
        tracker: makeTracker(),
        workspaceManager: inertWorkspaceManager,
      });

      return Effect.gen(function* () {
        const first = yield* orchestrator.pollOnce();
        const second = yield* orchestrator.pollOnce();
        return { first, second, loadCalls };
      });
    });

    expect(output.first).toEqual({ _tag: "Completed", intervalMs: 111 });
    expect(output.second).toEqual({ _tag: "Completed", intervalMs: 222 });
    expect(output.loadCalls).toBe(2);
  });

  it("releases issues when workers reach max turns", async () => {
    const output = await runWithOrchestrator(({ concurrency, stateRef }) =>
      Effect.gen(function* () {
        const orchestrator = makeOrchestrator({
          workflowPath,
          agent: inertAgent,
          concurrency,
          hookExecutor: inertHookExecutor,
          loader: makeLoader(() => Effect.succeed(loadedConfig())),
          promptRenderer: inertPromptRenderer,
          reconciler: makeReconciler(),
          stateRef,
          tracker: makeTracker({ fetchCandidateIssues: () => Effect.succeed([issue()]) }),
          workspaceManager: inertWorkspaceManager,
          workerFactory: () =>
            makeStaticWorker(Effect.succeed({ _tag: "MaxTurnsReached", turnCount: 2 })),
        });

        yield* orchestrator.pollOnce();
        yield* Effect.sleep("10 millis");
        return yield* stateRef.getSnapshot();
      }),
    );

    expect(output.running).toEqual([]);
    expect(output.retryQueue).toEqual([]);
    expect(output.claims).toEqual([]);
  });
});
