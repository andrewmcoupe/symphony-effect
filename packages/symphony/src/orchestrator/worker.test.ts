import { Effect, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { TurnResult } from "../agent/index.js";
import { NonZeroExit } from "../agent/index.js";
import type { PromptVariables, RenderErrorType } from "../config/index.js";
import type { TrackerClient } from "../tracker/index.js";
import { RequestFailed } from "../tracker/index.js";
import { CreationFailed, HookNonZeroExit } from "../workspace/index.js";
import type {
  HookExecutionResult,
  HookExecutorService,
  WorkspaceManagerService,
} from "../workspace/index.js";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./state/index.js";
import type { WorkerError as StateWorkerError } from "./state/types.js";
import {
  AgentFailed,
  HookFailed,
  makeWorker,
  type WorkerConfigValue,
  type WorkerError,
  type WorkerResult,
  WorkspaceCreationFailed,
  StateCheckFailed,
} from "./worker.js";
import type { AgentRunner } from "../agent/index.js";
import type { Issue } from "../tracker/index.js";
import type { PromptRenderer } from "../config/index.js";

const issue: Issue = {
  id: "issue-1",
  identifier: "ABC-1",
  title: "Implement worker",
  description: "Run issue through agent turns.",
  priority: 1,
  state: "Todo",
  branchName: "abc-1-worker",
  url: "https://linear.app/acme/issue/ABC-1",
  labels: ["backend"],
  blockedBy: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const baseConfig: WorkerConfigValue = {
  promptTemplate: "Issue {{ issue.identifier }} attempt {{ attempt | default: 'first' }}",
  activeStates: ["Todo", "In Progress"],
  hooks: {
    after_create: "after-create",
    before_run: "before-run",
    after_run: "after-run",
    timeout_ms: 1_000,
  },
  maxTurns: 3,
  agentTimeoutMs: 5_000,
};

interface WorkerMocks {
  readonly config?: WorkerConfigValue;
  readonly createdNow?: boolean;
  readonly workspaceError?: CreationFailed;
  readonly hookErrors?: Partial<Record<"after_create" | "before_run", HookNonZeroExit>>;
  readonly turnResults?: readonly TurnResult[];
  readonly turnError?: NonZeroExit;
  readonly trackerStates?: readonly string[];
  readonly trackerError?: RequestFailed;
  readonly renderError?: RenderErrorType;
}

const makeFiber = (): Fiber.RuntimeFiber<void, StateWorkerError> =>
  Effect.runFork(Effect.void) as Fiber.RuntimeFiber<void, StateWorkerError>;

const hookResult: HookExecutionResult = { exitCode: 0, stdout: "", stderr: "" };

const successTurn = (output = "ok"): TurnResult => ({
  success: true,
  output,
  exitCode: 0,
  tokensUsed: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
});

const makeHookError = (hook: string): HookNonZeroExit =>
  new HookNonZeroExit({
    hook,
    workspacePath: "/tmp/symphony/ABC-1",
    exitCode: 1,
    stdout: "",
    stderr: "failed",
  });

const runWithWorker = (mocks: WorkerMocks = {}) => {
  const hookCalls: string[] = [];
  const prompts: string[] = [];
  const workspaces: string[] = [];
  const turns = [...(mocks.turnResults ?? [successTurn()])];
  const trackerStates = [...(mocks.trackerStates ?? ["Done"])];

  const workspaceManager: WorkspaceManagerService = {
    getWorkspacePath: (identifier) => Effect.succeed(`/tmp/symphony/${identifier}`),
    listWorkspaceDirectories: () => Effect.succeed([]),
    ensureWorkspace: (identifier) => {
      workspaces.push(identifier);
      if (mocks.workspaceError !== undefined) return Effect.fail(mocks.workspaceError);
      return Effect.succeed({
        path: `/tmp/symphony/${identifier}`,
        createdNow: mocks.createdNow ?? true,
      });
    },
    removeWorkspace: () => Effect.void,
  };

  const hookExecutor: HookExecutorService = {
    executeHook: () => Effect.succeed(hookResult),
    executeLifecycleHook: ({ hookName }) => {
      hookCalls.push(hookName);
      const error = mocks.hookErrors?.[hookName as "after_create" | "before_run"];
      return error === undefined ? Effect.succeed(Option.some(hookResult)) : Effect.fail(error);
    },
  };

  const promptRenderer: PromptRenderer = {
    render: (_template: string, variables: PromptVariables) => {
      if (mocks.renderError !== undefined) return Effect.fail(mocks.renderError);
      const prompt = `prompt:${variables.issue.identifier}:${variables.attempt ?? "first"}`;
      prompts.push(prompt);
      return Effect.succeed(prompt);
    },
  };

  const agent: AgentRunner = {
    runTurn: () => {
      if (mocks.turnError !== undefined) return Effect.fail(mocks.turnError);
      return Effect.succeed(turns.shift() ?? successTurn("fallback"));
    },
  };

  const tracker: TrackerClient = {
    fetchCandidateIssues: () => Effect.succeed([]),
    fetchIssuesByStates: () => Effect.succeed([]),
    fetchIssueStatesByIds: (ids) => {
      if (mocks.trackerError !== undefined) return Effect.fail(mocks.trackerError);
      return Effect.succeed(new Map([[ids[0] ?? issue.id, trackerStates.shift() ?? "Done"]]));
    },
  };

  return Effect.runPromise(
    Effect.gen(function* () {
      const stateRef = yield* OrchestratorStateRef;
      yield* stateRef.markRunning(issue.id, makeFiber(), issue.identifier, issue.state);
      const worker = makeWorker({
        agent,
        config: mocks.config ?? baseConfig,
        hookExecutor,
        promptRenderer,
        stateRef,
        tracker,
        workspaceManager,
      });

      const result = yield* worker.runWorker(issue, null);
      const snapshot = yield* stateRef.getSnapshot();
      return { result, snapshot, hookCalls, prompts, workspaces };
    }).pipe(Effect.provide(OrchestratorStateRefLive)),
  );
};

const expectFailedWith = <T extends WorkerError>(
  result: WorkerResult,
  errorClass: abstract new (...args: never[]) => T,
) => {
  expect(result._tag).toBe("Failed");
  if (result._tag === "Failed") expect(result.error).toBeInstanceOf(errorClass);
};

describe("Worker", () => {
  it("prepares the workspace, runs hooks, executes turns, and records activity", async () => {
    const output = await runWithWorker({
      trackerStates: ["Todo", "Done"],
      turnResults: [successTurn("first"), successTurn("second")],
    });

    expect(output.result).toEqual({ _tag: "IssueNoLongerActive", turnCount: 2 });
    expect(output.workspaces).toEqual(["ABC-1"]);
    expect(output.hookCalls).toEqual(["after_create", "before_run", "after_run"]);
    expect(output.prompts).toEqual(["prompt:ABC-1:first", "prompt:ABC-1:first"]);
    expect(output.snapshot.running[0]).toMatchObject({ issueId: "issue-1", turnCount: 2 });
    expect(output.snapshot.tokenTotals).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      runtimeSeconds: 0,
    });
  });

  it("skips after_create when reusing an existing workspace", async () => {
    const output = await runWithWorker({ createdNow: false, trackerStates: ["Done"] });

    expect(output.result).toEqual({ _tag: "IssueNoLongerActive", turnCount: 1 });
    expect(output.hookCalls).toEqual(["before_run", "after_run"]);
  });

  it("stops with MaxTurnsReached when the issue remains active", async () => {
    const output = await runWithWorker({
      config: { ...baseConfig, maxTurns: 2 },
      trackerStates: ["Todo", "Todo"],
      turnResults: [successTurn("one"), successTurn("two")],
    });

    expect(output.result).toEqual({ _tag: "MaxTurnsReached", turnCount: 2 });
    expect(output.snapshot.running[0]?.turnCount).toBe(2);
  });

  it("returns Failed for workspace creation failures", async () => {
    const result = await runWithWorker({
      workspaceError: new CreationFailed({ path: "/tmp/symphony/ABC-1", reason: "denied" }),
    });

    expectFailedWith(result.result, WorkspaceCreationFailed);
    expect(result.hookCalls).toEqual([]);
  });

  it("returns Failed for fatal hook failures", async () => {
    const result = await runWithWorker({
      hookErrors: { before_run: makeHookError("before-run") },
    });

    expectFailedWith(result.result, HookFailed);
    expect(result.result.turnCount).toBe(0);
    expect(result.hookCalls).toEqual(["after_create", "before_run"]);
  });

  it("returns Failed for unsuccessful agent turns", async () => {
    const result = await runWithWorker({
      turnResults: [{ success: false, output: "agent reported failure", exitCode: 0 }],
    });

    expectFailedWith(result.result, AgentFailed);
    expect(result.result.turnCount).toBe(0);
    expect(result.hookCalls).toEqual(["after_create", "before_run", "after_run"]);
  });

  it("returns Failed when state refresh fails after a completed turn", async () => {
    const result = await runWithWorker({
      trackerError: new RequestFailed({
        endpoint: "https://linear.example/graphql",
        reason: "bad",
      }),
    });

    expectFailedWith(result.result, StateCheckFailed);
    expect(result.result.turnCount).toBe(1);
    expect(result.snapshot.running[0]?.turnCount).toBe(1);
  });

  it("runs after_run when interrupted after before_run", async () => {
    const hookCalls: string[] = [];
    const workerEffect = Effect.gen(function* () {
      const stateRef = yield* OrchestratorStateRef;
      yield* stateRef.markRunning(issue.id, makeFiber(), issue.identifier, issue.state);
      const worker = makeWorker({
        agent: { runTurn: () => Effect.never },
        config: baseConfig,
        hookExecutor: {
          executeHook: () => Effect.succeed(hookResult),
          executeLifecycleHook: ({ hookName }) => {
            hookCalls.push(hookName);
            return Effect.succeed(Option.some(hookResult));
          },
        },
        promptRenderer: { render: () => Effect.succeed("prompt") },
        stateRef,
        tracker: {
          fetchCandidateIssues: () => Effect.succeed([]),
          fetchIssuesByStates: () => Effect.succeed([]),
          fetchIssueStatesByIds: () => Effect.succeed(new Map([[issue.id, "Todo"]])),
        },
        workspaceManager: {
          getWorkspacePath: (identifier) => Effect.succeed(`/tmp/symphony/${identifier}`),
          ensureWorkspace: (identifier) =>
            Effect.succeed({ path: `/tmp/symphony/${identifier}`, createdNow: true }),
          removeWorkspace: () => Effect.void,
        },
      });

      const fiber = yield* Effect.fork(worker.runWorker(issue, null));
      yield* Effect.sleep("10 millis");
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(OrchestratorStateRefLive));

    await Effect.runPromise(workerEffect);

    expect(hookCalls).toEqual(["after_create", "before_run", "after_run"]);
  });
});
