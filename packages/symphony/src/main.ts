#!/usr/bin/env node

import { NodeFileSystem, NodePath, NodeTerminal } from "@effect/platform-node";
import { Cause, Effect, Exit, Fiber, Layer, Logger, Option, Scope } from "effect";
import { HttpServer, type HttpServerBinding } from "./observability/index.js";
import {
  Orchestrator,
  OrchestratorStateRef,
  type OrchestratorStateRefService,
} from "./orchestrator/index.js";
import { TrackerClient, type Issue } from "./tracker/index.js";
import { ConfigLoader, ConfigLoaderLive, type LoadedConfig } from "./config/index.js";
import { makeMainLive } from "./layers.js";
import { HookExecutor, WorkspaceManager } from "./workspace/index.js";
import { type CliOptions, runCli } from "./cli.js";

const SHUTDOWN_TIMEOUT_MS = 30_000;

type MainLayer = ReturnType<typeof makeMainLive>;
type MainEnvironment = Layer.Layer.Success<MainLayer>;
type MainLayerError = Layer.Layer.Error<MainLayer>;

export interface StartupActions<R, E> {
  readonly loadWorkflow: (workflowPath: string) => Effect.Effect<LoadedConfig, E>;
  readonly buildLayer: (options: {
    readonly loaded: LoadedConfig;
    readonly workflowPath: string;
  }) => Layer.Layer<R, E>;
  readonly cleanupTerminalIssues: (loaded: LoadedConfig) => Effect.Effect<void, E, R>;
  readonly startHttpServer: (port: number) => Effect.Effect<HttpServerBinding, E, R | Scope.Scope>;
  readonly startPollingLoop: () => Effect.Effect<void, E, R>;
  readonly gracefulShutdown: () => Effect.Effect<void, never, R>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const cleanupIssueWorkspace = (
  issue: Issue,
  loaded: LoadedConfig,
): Effect.Effect<void, never, WorkspaceManager | HookExecutor> =>
  Effect.gen(function* () {
    const hooks = loaded.config.hooks;
    const hookExecutor = yield* HookExecutor;
    const workspaceManager = yield* WorkspaceManager;
    const workspacePath = yield* workspaceManager.getWorkspacePath(issue.identifier);

    yield* hookExecutor
      .executeLifecycleHook({
        hook: hooks.before_remove,
        hookName: "before_remove",
        workspacePath,
        timeoutMs: hooks.timeout_ms,
        issueIdentifier: issue.identifier,
      })
      .pipe(Effect.catchAll((error) => Effect.logWarning(error.message)));

    yield* workspaceManager
      .removeWorkspace(issue.identifier)
      .pipe(Effect.catchAll((error) => Effect.logWarning(error.message)));
  }).pipe(
    Effect.catchAll((error) => Effect.logWarning(error.message)),
    Effect.asVoid,
  );

const waitForRunningWorkers = (stateRef: OrchestratorStateRefService): Effect.Effect<void> =>
  Effect.gen(function* () {
    const state = yield* stateRef.getState();
    const fibers = Array.from(state.running.values()).map((running) => running.fiber);

    if (fibers.length === 0) return;

    yield* Effect.logInfo(`Waiting up to ${SHUTDOWN_TIMEOUT_MS}ms for ${fibers.length} worker(s)`);
    const completed = yield* Fiber.awaitAll(fibers).pipe(Effect.timeoutOption(SHUTDOWN_TIMEOUT_MS));

    if (Option.isSome(completed)) return;

    yield* Effect.logWarning("Graceful shutdown timed out; interrupting remaining workers");
    yield* Fiber.interruptAll(fibers);
  });

export const liveStartupActions: StartupActions<MainEnvironment, MainLayerError | unknown> = {
  loadWorkflow: (workflowPath) =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader;
      return yield* loader.load(workflowPath);
    }).pipe(Effect.provide(ConfigLoaderLive)),

  buildLayer: (options) => makeMainLive(options) as Layer.Layer<MainEnvironment>,

  cleanupTerminalIssues: (loaded) =>
    Effect.gen(function* () {
      const tracker = yield* TrackerClient;
      const issues = yield* tracker.fetchIssuesByStates(loaded.config.tracker.terminal_states);

      yield* Effect.logInfo(`Cleaning ${issues.length} terminal workspace(s)`);
      yield* Effect.forEach(issues, (issue) => cleanupIssueWorkspace(issue, loaded), {
        discard: true,
      });
    }),

  startHttpServer: (port) =>
    Effect.gen(function* () {
      const server = yield* HttpServer;
      return yield* server.start({ port });
    }),

  startPollingLoop: () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      return yield* orchestrator.start();
    }),

  gracefulShutdown: () =>
    Effect.gen(function* () {
      const stateRef = yield* OrchestratorStateRef;
      yield* waitForRunningWorkers(stateRef);
    }).pipe(Effect.catchAllCause((cause) => Effect.logWarning(Cause.pretty(cause)))),
};

export const startSymphony = <R, E>(
  options: CliOptions,
  actions: StartupActions<R, E>,
): Effect.Effect<void, E> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Symphony starting...");
    yield* Effect.logInfo(`Loading workflow from ${options.workflowPath}`);
    const loaded = yield* actions.loadWorkflow(options.workflowPath);
    const { config } = loaded;

    yield* Effect.logInfo(
      `Tracker: ${config.tracker.kind} (project: ${config.tracker.project_slug})`,
    );
    yield* Effect.logInfo(`Workspace root: ${config.workspace.root}`);
    yield* Effect.logInfo(`Max concurrent agents: ${config.agent.max_concurrent_agents}`);
    yield* Effect.logInfo(`Polling interval: ${config.polling.interval_ms}ms`);

    const layer = actions.buildLayer({ loaded, workflowPath: options.workflowPath });

    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => actions.gracefulShutdown());
        yield* actions.cleanupTerminalIssues(loaded);

        if (options.port !== undefined) {
          const binding = yield* actions.startHttpServer(options.port);
          yield* Effect.logInfo(`HTTP server listening on http://${binding.host}:${binding.port}`);
        }

        yield* Effect.logInfo("Starting polling loop...");
        yield* actions.startPollingLoop();
      }).pipe(Effect.provide(layer)),
    );
  });

export const mainEffect = (
  args: ReadonlyArray<string> = process.argv,
): Effect.Effect<void, unknown> => {
  const run = (options: CliOptions) =>
    startSymphony(options, liveStartupActions).pipe(
      Effect.tapError((error) => Effect.logError(`Startup failed: ${errorMessage(error)}`)),
    );
  const effect = runCli(args, run).pipe(
    Effect.provide(NodeFileSystem.layer),
    Effect.provide(NodePath.layer),
    Effect.provide(NodeTerminal.layer),
  );

  return process.env.NODE_ENV === "production" ? effect.pipe(Effect.provide(Logger.json)) : effect;
};

export const runMain = (args: ReadonlyArray<string> = process.argv): void => {
  const fiber = Effect.runFork(mainEffect(args));

  const interrupt = (signal: NodeJS.Signals): void => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    Effect.runFork(
      Effect.logInfo(`Received ${signal}; shutting down`).pipe(
        Effect.zipRight(Fiber.interrupt(fiber)),
      ),
    );
  };

  const onSigint = (): void => interrupt("SIGINT");
  const onSigterm = (): void => interrupt("SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  Effect.runPromise(Fiber.await(fiber)).then((exit) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.exitCode = Exit.isSuccess(exit) || Exit.isInterrupted(exit) ? 0 : 1;
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runMain();
}
