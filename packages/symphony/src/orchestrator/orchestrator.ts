import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { ConfigLoader, type LoadedConfig } from "../config/index.js";
import type { AgentRunner } from "../agent/index.js";
import type { PromptRenderer } from "../config/index.js";
import { TrackerClient } from "../tracker/index.js";
import type { Issue } from "../tracker/index.js";
import type { HookExecutor, WorkspaceManager } from "../workspace/index.js";
import { ConcurrencyController } from "./concurrency.js";
import { makeDispatchDecider } from "./dispatch.js";
import { makeReconcilerConfigFromLoadedConfig, Reconciler } from "./reconciliation.js";
import { makeRetryScheduler } from "./retry.js";
import { OrchestratorStateRef, type RetryEntry } from "./state/index.js";
import type { WorkerError as StateWorkerError } from "./state/types.js";
import {
  makeWorker,
  makeWorkerConfigFromLoadedConfig,
  type Worker,
  type WorkerResult,
} from "./worker.js";
import { AgentRunner as AgentRunnerTag } from "../agent/index.js";
import { PromptRenderer as PromptRendererTag } from "../config/index.js";
import {
  HookExecutor as HookExecutorTag,
  WorkspaceManager as WorkspaceManagerTag,
} from "../workspace/index.js";

const DEFAULT_POLLING_INTERVAL_MS = 30_000;

export interface PollTickResult {
  readonly _tag: "Completed" | "ConfigError" | "TrackerError";
  readonly intervalMs: number;
}

export interface Orchestrator {
  readonly pollOnce: () => Effect.Effect<PollTickResult>;
  readonly start: () => Effect.Effect<void>;
}

export interface OrchestratorConfigValue {
  readonly workflowPath: string;
  readonly defaultPollingIntervalMs?: number;
}

interface WorkerFactoryOptions {
  readonly loaded: LoadedConfig;
  readonly agent: AgentRunner;
  readonly hookExecutor: HookExecutor;
  readonly promptRenderer: PromptRenderer;
  readonly stateRef: OrchestratorStateRef;
  readonly tracker: TrackerClient;
  readonly workspaceManager: WorkspaceManager;
}

interface MakeOrchestratorOptions extends OrchestratorConfigValue {
  readonly agent: AgentRunner;
  readonly concurrency: ConcurrencyController;
  readonly hookExecutor: HookExecutor;
  readonly loader: ConfigLoader;
  readonly now?: () => number;
  readonly promptRenderer: PromptRenderer;
  readonly reconciler: Reconciler;
  readonly stateRef: OrchestratorStateRef;
  readonly tracker: TrackerClient;
  readonly workspaceManager: WorkspaceManager;
  readonly workerFactory?: (options: WorkerFactoryOptions) => Worker;
}

export const Orchestrator = Context.GenericTag<Orchestrator>("symphony/Orchestrator");

export const OrchestratorConfig = Context.GenericTag<OrchestratorConfigValue>(
  "symphony/OrchestratorConfig",
);

const getErrorMessage = (error: { readonly message?: string }): string =>
  error.message ?? String(error);

const nextFailureAttempt = (attempt: number | null): number => Math.max(0, attempt ?? 0) + 1;

const requeueDueRetries =
  (stateRef: OrchestratorStateRef) =>
  (entries: readonly RetryEntry[]): Effect.Effect<void> =>
    Effect.forEach(
      entries,
      (entry) =>
        stateRef.markRetryQueued(entry.issueId, entry.attempt, entry.error, {
          identifier: entry.identifier,
          dueAt: entry.dueAt,
        }),
      { discard: true },
    );

const issueById = (issues: readonly Issue[]): Map<string, Issue> =>
  new Map(issues.map((issue) => [issue.id, issue]));

const removeDueIssues = (
  issues: readonly Issue[],
  dueRetries: readonly RetryEntry[],
): ReadonlyArray<Issue> => {
  const dueIssueIds = new Set(dueRetries.map((entry) => entry.issueId));
  return issues.filter((issue) => !dueIssueIds.has(issue.id));
};

const defaultWorkerFactory = ({
  agent,
  hookExecutor,
  loaded,
  promptRenderer,
  stateRef,
  tracker,
  workspaceManager,
}: WorkerFactoryOptions): Worker =>
  makeWorker({
    agent,
    config: makeWorkerConfigFromLoadedConfig(loaded),
    hookExecutor,
    promptRenderer,
    stateRef,
    tracker,
    workspaceManager,
  });

export const makeOrchestrator = ({
  agent,
  concurrency,
  defaultPollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
  hookExecutor,
  loader,
  now = Date.now,
  promptRenderer,
  reconciler,
  stateRef,
  tracker,
  workflowPath,
  workerFactory = defaultWorkerFactory,
  workspaceManager,
}: MakeOrchestratorOptions): Orchestrator => {
  const makeRetry = (loaded: LoadedConfig) =>
    makeRetryScheduler({
      config: { max_retry_backoff_ms: loaded.config.agent.max_retry_backoff_ms },
      now,
      stateRef,
    });

  const dispatchIssue = (
    loaded: LoadedConfig,
    issue: Issue,
    attempt: number | null,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* stateRef.claimIssue(issue.id, issue.identifier);

      const acquired = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const retry = makeRetry(loaded);
      const worker = workerFactory({
        agent,
        hookExecutor,
        loaded,
        promptRenderer,
        stateRef,
        tracker,
        workspaceManager,
      });

      const handleResult = (result: WorkerResult): Effect.Effect<void> => {
        switch (result._tag) {
          case "Completed":
            return retry.scheduleContinuation(issue.id, issue.identifier);
          case "Failed":
            return retry.scheduleRetry(
              issue.id,
              issue.identifier,
              nextFailureAttempt(attempt),
              result.error.message,
            );
          case "IssueNoLongerActive":
          case "MaxTurnsReached":
            return stateRef.releaseIssue(issue.id);
        }
      };

      const workerProgram = Effect.scoped(
        Effect.gen(function* () {
          yield* concurrency.acquireSlot();
          yield* Deferred.succeed(acquired, undefined);
          yield* Deferred.await(started);
          const result = yield* worker.runWorker(issue, attempt);
          yield* handleResult(result);
        }),
      ).pipe(
        Effect.catchAllCause((cause) =>
          Effect.logWarning(`Worker fiber failed for ${issue.identifier}: ${cause.toString()}`),
        ),
      );

      const fiber = yield* Effect.forkDaemon(workerProgram);
      yield* Deferred.await(acquired);
      yield* stateRef.markRunning(
        issue.id,
        fiber as Fiber.RuntimeFiber<void, StateWorkerError>,
        issue.identifier,
        issue.state,
        attempt,
      );
      yield* Deferred.succeed(started, undefined);
    });

  const dispatchDueRetries = (
    loaded: LoadedConfig,
    candidates: readonly Issue[],
    dueRetries: readonly RetryEntry[],
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const dispatch = makeDispatchDecider({
        config: loaded.config.tracker,
        concurrency,
        stateRef,
      });
      const candidatesById = issueById(candidates);

      for (const entry of dueRetries) {
        const issue = candidatesById.get(entry.issueId);
        if (issue === undefined) {
          yield* stateRef.releaseIssue(entry.issueId);
          continue;
        }

        const eligible = yield* dispatch.isEligible(issue);
        if (!eligible) {
          yield* stateRef.markRetryQueued(entry.issueId, entry.attempt, entry.error, {
            identifier: entry.identifier,
            dueAt: entry.dueAt,
          });
          continue;
        }

        yield* dispatchIssue(loaded, issue, entry.attempt);
      }
    });

  const dispatchNewCandidates = (
    loaded: LoadedConfig,
    candidates: readonly Issue[],
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const dispatch = makeDispatchDecider({
        config: loaded.config.tracker,
        concurrency,
        stateRef,
      });
      const dispatchable = yield* dispatch.getDispatchableIssues(candidates);

      for (const issue of dispatchable) {
        const canDispatch = yield* concurrency.canDispatch(issue.state);
        if (!canDispatch) break;
        yield* dispatchIssue(loaded, issue, null);
      }
    });

  const pollOnce = (): Effect.Effect<PollTickResult> =>
    Effect.gen(function* () {
      const loadedResult = yield* loader.load(workflowPath).pipe(Effect.either);
      yield* reconciler.reconcile(
        loadedResult._tag === "Right"
          ? makeReconcilerConfigFromLoadedConfig(loadedResult.right)
          : undefined,
      );

      if (loadedResult._tag === "Left") {
        yield* Effect.logError(
          `Skipping dispatch due to config error: ${loadedResult.left.message}`,
        );
        yield* stateRef.recordPoll(now());
        return { _tag: "ConfigError", intervalMs: defaultPollingIntervalMs };
      }

      const loaded = loadedResult.right;
      const intervalMs = loaded.config.polling.interval_ms;
      const retry = makeRetry(loaded);
      const dueRetries = yield* retry.getDueRetries();
      const candidatesResult = yield* tracker.fetchCandidateIssues().pipe(Effect.either);

      if (candidatesResult._tag === "Left") {
        yield* requeueDueRetries(stateRef)(dueRetries);
        yield* Effect.logError(
          `Skipping dispatch due to tracker error: ${getErrorMessage(candidatesResult.left)}`,
        );
        yield* stateRef.recordPoll(now());
        return { _tag: "TrackerError", intervalMs };
      }

      yield* dispatchDueRetries(loaded, candidatesResult.right, dueRetries);
      yield* dispatchNewCandidates(loaded, removeDueIssues(candidatesResult.right, dueRetries));
      yield* stateRef.recordPoll(now());
      return { _tag: "Completed", intervalMs };
    });

  const start = (): Effect.Effect<void> => {
    const loop: Effect.Effect<void> = pollOnce().pipe(
      Effect.flatMap((result) => Effect.sleep(result.intervalMs)),
      Effect.zipRight(Effect.suspend(() => loop)),
    );
    return loop;
  };

  return { pollOnce, start };
};

export const OrchestratorLive: Layer.Layer<
  Orchestrator,
  never,
  | AgentRunner
  | ConfigLoader
  | ConcurrencyController
  | HookExecutor
  | OrchestratorConfigValue
  | OrchestratorStateRef
  | PromptRenderer
  | Reconciler
  | TrackerClient
  | WorkspaceManager
> = Layer.effect(
  Orchestrator,
  Effect.gen(function* () {
    const agent = yield* AgentRunnerTag;
    const config = yield* OrchestratorConfig;
    const concurrency = yield* ConcurrencyController;
    const hookExecutor = yield* HookExecutorTag;
    const loader = yield* ConfigLoader;
    const promptRenderer = yield* PromptRendererTag;
    const reconciler = yield* Reconciler;
    const stateRef = yield* OrchestratorStateRef;
    const tracker = yield* TrackerClient;
    const workspaceManager = yield* WorkspaceManagerTag;

    return makeOrchestrator({
      ...config,
      agent,
      concurrency,
      hookExecutor,
      loader,
      promptRenderer,
      reconciler,
      stateRef,
      tracker,
      workspaceManager,
    });
  }),
);

export const makeOrchestratorLive = (
  config: OrchestratorConfigValue,
): Layer.Layer<
  Orchestrator,
  never,
  | AgentRunner
  | ConfigLoader
  | ConcurrencyController
  | HookExecutor
  | OrchestratorStateRef
  | PromptRenderer
  | Reconciler
  | TrackerClient
  | WorkspaceManager
> => OrchestratorLive.pipe(Layer.provide(Layer.succeed(OrchestratorConfig, config)));
