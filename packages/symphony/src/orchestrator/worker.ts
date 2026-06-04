import { Context, Data, Effect, Layer, Ref } from "effect";
import { AgentRunner } from "../agent/index.js";
import type { TokenUsage, TurnResult } from "../agent/index.js";
import type { AgentError } from "../agent/errors.js";
import { PromptRenderer } from "../config/index.js";
import type { LoadedConfig, RenderErrorType, WorkflowConfig } from "../config/index.js";
import { TrackerClient } from "../tracker/index.js";
import type { Issue, TrackerError } from "../tracker/index.js";
import { HookExecutor, WorkspaceManager } from "../workspace/index.js";
import type { HookError, WorkspaceError } from "../workspace/index.js";
import { OrchestratorStateRef } from "./state/index.js";

export class WorkspaceCreationFailed extends Data.TaggedError(
  "WorkerError.WorkspaceCreationFailed",
)<{
  readonly issueId: string;
  readonly identifier: string;
  readonly cause: WorkspaceError;
}> {
  override get message(): string {
    return `Worker failed to prepare workspace for ${this.identifier}: ${this.cause.message}`;
  }
}

export class HookFailed extends Data.TaggedError("WorkerError.HookFailed")<{
  readonly issueId: string;
  readonly identifier: string;
  readonly hookName: "after_create" | "before_run";
  readonly cause: HookError;
}> {
  override get message(): string {
    return `Worker hook ${this.hookName} failed for ${this.identifier}: ${this.cause.message}`;
  }
}

export class AgentFailed extends Data.TaggedError("WorkerError.AgentFailed")<{
  readonly issueId: string;
  readonly identifier: string;
  readonly reason: string;
  readonly cause?: AgentError | RenderErrorType;
}> {
  override get message(): string {
    return `Worker agent turn failed for ${this.identifier}: ${this.reason}`;
  }
}

export class StateCheckFailed extends Data.TaggedError("WorkerError.StateCheckFailed")<{
  readonly issueId: string;
  readonly identifier: string;
  readonly cause?: TrackerError;
  readonly reason: string;
}> {
  override get message(): string {
    return `Worker failed to refresh tracker state for ${this.identifier}: ${this.reason}`;
  }
}

export type WorkerError = WorkspaceCreationFailed | HookFailed | AgentFailed | StateCheckFailed;

export const WorkerError = {
  WorkspaceCreationFailed,
  HookFailed,
  AgentFailed,
  StateCheckFailed,
} as const;

export type WorkerResult =
  | { readonly _tag: "Completed"; readonly turnCount: number }
  | { readonly _tag: "MaxTurnsReached"; readonly turnCount: number }
  | { readonly _tag: "IssueNoLongerActive"; readonly turnCount: number }
  | { readonly _tag: "Failed"; readonly error: WorkerError; readonly turnCount: number };

export interface WorkerConfigValue {
  readonly promptTemplate: string;
  readonly activeStates: readonly string[];
  readonly hooks: WorkflowConfig["hooks"];
  readonly maxTurns: number;
  readonly agentTimeoutMs: number;
}

export interface Worker {
  readonly runWorker: (issue: Issue, attempt: number | null) => Effect.Effect<WorkerResult>;
}

export const Worker = Context.GenericTag<Worker>("symphony/Worker");
export const WorkerConfig = Context.GenericTag<WorkerConfigValue>("symphony/WorkerConfig");

const normalizeStateName = (state: string): string => state.trim().toLowerCase();

const tokenUsageDelta = (
  tokens: TokenUsage,
): {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
} => ({
  ...(tokens.inputTokens === undefined ? {} : { inputTokens: tokens.inputTokens }),
  ...(tokens.outputTokens === undefined ? {} : { outputTokens: tokens.outputTokens }),
  ...(tokens.totalTokens === undefined ? {} : { totalTokens: tokens.totalTokens }),
});

const failedAgentResult = (issue: Issue, result: TurnResult): AgentFailed =>
  new AgentFailed({
    issueId: issue.id,
    identifier: issue.identifier,
    reason:
      result.output ||
      (result.exitCode === undefined
        ? "Claude Code reported an unsuccessful turn"
        : `Claude Code reported an unsuccessful turn with exit code ${result.exitCode}`),
  });

const fetchIssueState = ({
  issue,
  tracker,
}: {
  readonly issue: Issue;
  readonly tracker: TrackerClient;
}): Effect.Effect<string, StateCheckFailed> =>
  tracker.fetchIssueStatesByIds([issue.id]).pipe(
    Effect.mapError(
      (cause) =>
        new StateCheckFailed({
          issueId: issue.id,
          identifier: issue.identifier,
          cause,
          reason: cause.message,
        }),
    ),
    Effect.flatMap((states) => {
      const state = states.get(issue.id);
      return state === undefined
        ? Effect.fail(
            new StateCheckFailed({
              issueId: issue.id,
              identifier: issue.identifier,
              reason: `tracker did not return a state for issue ${issue.id}`,
            }),
          )
        : Effect.succeed(state);
    }),
  );

export const makeWorker = ({
  agent,
  config,
  hookExecutor,
  promptRenderer,
  stateRef,
  tracker,
  workspaceManager,
}: {
  readonly agent: AgentRunner;
  readonly config: WorkerConfigValue;
  readonly hookExecutor: HookExecutor;
  readonly promptRenderer: PromptRenderer;
  readonly stateRef: OrchestratorStateRef;
  readonly tracker: TrackerClient;
  readonly workspaceManager: WorkspaceManager;
}): Worker => {
  const activeStates = new Set(config.activeStates.map(normalizeStateName));

  const runWorker = (issue: Issue, attempt: number | null): Effect.Effect<WorkerResult> =>
    Effect.gen(function* () {
      const workspacePathRef = yield* Ref.make<string | undefined>(undefined);
      const afterRunEnabledRef = yield* Ref.make(false);
      const turnCountRef = yield* Ref.make(0);
      const sessionIdRef = yield* Ref.make<string | undefined>(undefined);

      const runAfterRun = Ref.get(afterRunEnabledRef).pipe(
        Effect.flatMap((enabled) => {
          if (!enabled) return Effect.void;

          return Ref.get(workspacePathRef).pipe(
            Effect.flatMap((workspacePath) => {
              if (workspacePath === undefined) return Effect.void;

              return hookExecutor
                .executeLifecycleHook({
                  hook: config.hooks.after_run,
                  hookName: "after_run",
                  workspacePath,
                  timeoutMs: config.hooks.timeout_ms,
                  issueIdentifier: issue.identifier,
                })
                .pipe(
                  Effect.catchAll((error) => Effect.logWarning(error.message)),
                  Effect.asVoid,
                );
            }),
          );
        }),
      );

      const runLoop = (workspacePath: string): Effect.Effect<WorkerResult, WorkerError> =>
        Effect.gen(function* () {
          const prompt = yield* promptRenderer
            .render(config.promptTemplate, { issue, attempt })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AgentFailed({
                    issueId: issue.id,
                    identifier: issue.identifier,
                    cause,
                    reason: cause.message,
                  }),
              ),
            );

          const resumeSessionId = yield* Ref.get(sessionIdRef);
          const turn = yield* agent
            .runTurn({
              prompt,
              workspacePath,
              timeoutMs: config.agentTimeoutMs,
              ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AgentFailed({
                    issueId: issue.id,
                    identifier: issue.identifier,
                    cause,
                    reason: cause.message,
                  }),
              ),
            );

          if (!turn.success) return yield* Effect.fail(failedAgentResult(issue, turn));
          if (turn.sessionId !== undefined) yield* Ref.set(sessionIdRef, turn.sessionId);

          const turnCount = yield* Ref.updateAndGet(turnCountRef, (count) => count + 1);
          yield* stateRef.recordTurn(issue.id);
          if (turn.tokensUsed !== undefined)
            yield* stateRef.incrementTokens(tokenUsageDelta(turn.tokensUsed));

          const currentState = yield* fetchIssueState({ issue, tracker });
          if (!activeStates.has(normalizeStateName(currentState))) {
            return { _tag: "IssueNoLongerActive", turnCount };
          }

          if (turnCount >= config.maxTurns) return { _tag: "MaxTurnsReached", turnCount };

          return { _tag: "Completed", turnCount };
        });

      const core = Effect.gen(function* () {
        const workspace = yield* workspaceManager.ensureWorkspace(issue.identifier).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceCreationFailed({
                issueId: issue.id,
                identifier: issue.identifier,
                cause,
              }),
          ),
        );
        yield* Ref.set(workspacePathRef, workspace.path);

        if (workspace.createdNow) {
          yield* hookExecutor
            .executeLifecycleHook({
              hook: config.hooks.after_create,
              hookName: "after_create",
              workspacePath: workspace.path,
              timeoutMs: config.hooks.timeout_ms,
              issueIdentifier: issue.identifier,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new HookFailed({
                    issueId: issue.id,
                    identifier: issue.identifier,
                    hookName: "after_create",
                    cause,
                  }),
              ),
            );
        }

        yield* hookExecutor
          .executeLifecycleHook({
            hook: config.hooks.before_run,
            hookName: "before_run",
            workspacePath: workspace.path,
            timeoutMs: config.hooks.timeout_ms,
            issueIdentifier: issue.identifier,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new HookFailed({
                  issueId: issue.id,
                  identifier: issue.identifier,
                  hookName: "before_run",
                  cause,
                }),
            ),
          );
        yield* Ref.set(afterRunEnabledRef, true);

        return yield* runLoop(workspace.path);
      }).pipe(
        Effect.catchAll((error) =>
          Ref.get(turnCountRef).pipe(
            Effect.map((turnCount) => ({ _tag: "Failed", error, turnCount }) as const),
          ),
        ),
      );

      return yield* core.pipe(
        Effect.flatMap((result) => runAfterRun.pipe(Effect.as(result))),
        Effect.onInterrupt(() => runAfterRun),
      );
    });

  return { runWorker };
};

export const makeWorkerConfigFromLoadedConfig = (
  loaded: LoadedConfig,
  options: { readonly agentTimeoutMs?: number } = {},
): WorkerConfigValue => ({
  promptTemplate: loaded.promptTemplate,
  activeStates: loaded.config.tracker.active_states,
  hooks: loaded.config.hooks,
  maxTurns: loaded.config.agent.max_turns,
  agentTimeoutMs: options.agentTimeoutMs ?? loaded.config.hooks.timeout_ms,
});

export const WorkerLive: Layer.Layer<
  Worker,
  never,
  | AgentRunner
  | HookExecutor
  | OrchestratorStateRef
  | PromptRenderer
  | TrackerClient
  | WorkerConfigValue
  | WorkspaceManager
> = Layer.effect(
  Worker,
  Effect.gen(function* () {
    const agent = yield* AgentRunner;
    const config = yield* WorkerConfig;
    const hookExecutor = yield* HookExecutor;
    const promptRenderer = yield* PromptRenderer;
    const stateRef = yield* OrchestratorStateRef;
    const tracker = yield* TrackerClient;
    const workspaceManager = yield* WorkspaceManager;
    return makeWorker({
      agent,
      config,
      hookExecutor,
      promptRenderer,
      stateRef,
      tracker,
      workspaceManager,
    });
  }),
);

export const makeWorkerLive = (
  config: WorkerConfigValue,
): Layer.Layer<
  Worker,
  never,
  | AgentRunner
  | HookExecutor
  | OrchestratorStateRef
  | PromptRenderer
  | TrackerClient
  | WorkspaceManager
> => WorkerLive.pipe(Layer.provide(Layer.succeed(WorkerConfig, config)));

export const runWorker = (
  issue: Issue,
  attempt: number | null,
): Effect.Effect<WorkerResult, never, Worker> =>
  Worker.pipe(Effect.flatMap((worker) => worker.runWorker(issue, attempt)));
