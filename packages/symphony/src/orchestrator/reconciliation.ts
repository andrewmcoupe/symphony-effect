import { Context, Effect, Fiber, Layer } from "effect";
import type { LoadedConfig, WorkflowConfig } from "../config/index.js";
import { TrackerClient } from "../tracker/index.js";
import { HookExecutor, WorkspaceManager } from "../workspace/index.js";
import { makeRetryScheduler } from "./retry.js";
import { OrchestratorStateRef, type RunningIssue } from "./state/index.js";

export interface Reconciler {
  readonly reconcile: (config?: ReconcilerConfigValue) => Effect.Effect<void>;
}

export interface ReconcilerConfigValue {
  readonly activeStates: readonly string[];
  readonly terminalStates: readonly string[];
  readonly hooks: WorkflowConfig["hooks"];
  readonly stallTimeoutMs: number;
  readonly maxRetryBackoffMs: number;
}

export const Reconciler = Context.GenericTag<Reconciler>("symphony/Reconciler");

const normalizeStateName = (state: string): string => state.trim().toLowerCase();

const normalizeStateSet = (states: readonly string[]): ReadonlySet<string> =>
  new Set(states.map(normalizeStateName));

const stalledAttempt = (running: RunningIssue): number => (running.attempt ?? 0) + 1;

export const makeReconcilerConfigFromLoadedConfig = (
  loaded: LoadedConfig,
): ReconcilerConfigValue => ({
  activeStates: loaded.config.tracker.active_states,
  terminalStates: loaded.config.tracker.terminal_states,
  hooks: loaded.config.hooks,
  stallTimeoutMs: loaded.config.agent.stall_timeout_ms,
  maxRetryBackoffMs: loaded.config.agent.max_retry_backoff_ms,
});

export const makeReconciler = (options?: {
  readonly config?: ReconcilerConfigValue;
  readonly hookExecutor: HookExecutor;
  readonly now?: () => number;
  readonly stateRef: OrchestratorStateRef;
  readonly tracker: TrackerClient;
  readonly workspaceManager: WorkspaceManager;
}): Reconciler => {
  if (options === undefined) {
    return { reconcile: () => Effect.void };
  }

  const {
    config: defaultConfig,
    hookExecutor,
    now = Date.now,
    stateRef,
    tracker,
    workspaceManager,
  } = options;

  const runBeforeRemove = (
    config: ReconcilerConfigValue,
    running: RunningIssue,
  ): Effect.Effect<void> =>
    workspaceManager.getWorkspacePath(running.identifier).pipe(
      Effect.flatMap((workspacePath) =>
        hookExecutor.executeLifecycleHook({
          hook: config.hooks.before_remove,
          hookName: "before_remove",
          workspacePath,
          timeoutMs: config.hooks.timeout_ms,
          issueIdentifier: running.identifier,
        }),
      ),
      Effect.catchAll((error) => Effect.logWarning(error.message)),
      Effect.asVoid,
    );

  const removeWorkspace = (running: RunningIssue): Effect.Effect<void> =>
    workspaceManager.removeWorkspace(running.identifier).pipe(
      Effect.catchAll((error) => Effect.logWarning(error.message)),
      Effect.asVoid,
    );

  const stopRunningIssue = (running: RunningIssue): Effect.Effect<void> =>
    Fiber.interrupt(running.fiber).pipe(Effect.asVoid);

  const detectStalls = (config: ReconcilerConfigValue): Effect.Effect<void> => {
    if (config.stallTimeoutMs <= 0) return Effect.void;

    const retry = makeRetryScheduler({
      config: { max_retry_backoff_ms: config.maxRetryBackoffMs },
      now,
      stateRef,
    });

    return Effect.gen(function* () {
      const state = yield* stateRef.getState();
      const currentTime = now();

      for (const running of state.running.values()) {
        const elapsed = currentTime - running.lastActivityAt;
        if (elapsed <= config.stallTimeoutMs) continue;

        yield* stopRunningIssue(running);
        yield* retry.scheduleRetry(
          running.issueId,
          running.identifier,
          stalledAttempt(running),
          "Stalled",
        );
        yield* Effect.logWarning(
          `Issue stalled: ${running.identifier} (${running.issueId}) elapsed=${elapsed}ms`,
        );
      }
    });
  };

  const refreshStates = (config: ReconcilerConfigValue): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = yield* stateRef.getState();
      const runningIssues = Array.from(state.running.values());
      if (runningIssues.length === 0) return;

      const states = yield* tracker
        .fetchIssueStatesByIds(runningIssues.map((running) => running.issueId))
        .pipe(
          Effect.tapError((error) =>
            Effect.logWarning(`State refresh failed during reconciliation: ${error.message}`),
          ),
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
      if (states === undefined) return;

      const activeStates = normalizeStateSet(config.activeStates);
      const terminalStates = normalizeStateSet(config.terminalStates);

      for (const running of runningIssues) {
        const currentState = states.get(running.issueId);

        if (currentState === undefined) {
          yield* stopRunningIssue(running);
          yield* stateRef.releaseIssue(running.issueId);
          continue;
        }

        const normalized = normalizeStateName(currentState);
        if (terminalStates.has(normalized)) {
          yield* stopRunningIssue(running);
          yield* runBeforeRemove(config, running);
          yield* removeWorkspace(running);
          yield* stateRef.releaseIssue(running.issueId);
          continue;
        }

        if (activeStates.has(normalized)) {
          yield* stateRef.updateTrackerState(running.issueId, currentState);
        }
      }
    });

  const reconcile = (config = defaultConfig): Effect.Effect<void> => {
    if (config === undefined) return Effect.void;
    return detectStalls(config).pipe(Effect.zipRight(refreshStates(config)));
  };

  return { reconcile };
};

export const ReconcilerLive: Layer.Layer<
  Reconciler,
  never,
  HookExecutor | OrchestratorStateRef | TrackerClient | WorkspaceManager
> = Layer.effect(
  Reconciler,
  Effect.gen(function* () {
    const hookExecutor = yield* HookExecutor;
    const stateRef = yield* OrchestratorStateRef;
    const tracker = yield* TrackerClient;
    const workspaceManager = yield* WorkspaceManager;
    return makeReconciler({ hookExecutor, stateRef, tracker, workspaceManager });
  }),
);
