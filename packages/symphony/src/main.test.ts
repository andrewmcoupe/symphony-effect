import { NodeFileSystem, NodePath, NodeTerminal } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "./config/index.js";
import { runCli } from "./cli.js";
import { startSymphony, type StartupActions } from "./main.js";

const loadedConfig: LoadedConfig = {
  config: {
    tracker: {
      kind: "linear",
      endpoint: "https://linear.example/graphql",
      api_key: "token",
      project_slug: "project",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    },
    polling: { interval_ms: 1_000 },
    workspace: { root: "/tmp/symphony" },
    hooks: { timeout_ms: 1_000 },
    agent: {
      max_concurrent_agents: 2,
      max_turns: 4,
      provider: "anthropic",
      stall_timeout_ms: 300_000,
      max_retry_backoff_ms: 300_000,
    },
  },
  promptTemplate: "Work on {{ issue.identifier }}",
};

const runCliWithNode = (effect: Effect.Effect<void, unknown, never>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(NodePath.layer),
      Effect.provide(NodeTerminal.layer),
    ),
  );

describe("CLI startup", () => {
  it("parses CLI options and runs the startup sequence in order", async () => {
    const events: string[] = [];
    const actions: StartupActions<never, Error> = {
      loadWorkflow: (workflowPath) =>
        Effect.sync(() => {
          events.push(`load:${workflowPath}`);
          return loadedConfig;
        }),
      buildLayer: ({ workflowPath }) => {
        events.push(`build:${workflowPath}`);
        return Layer.empty;
      },
      cleanupTerminalIssues: () =>
        Effect.sync(() => {
          events.push("cleanup-terminal");
        }),
      startHttpServer: (port) =>
        Effect.sync(() => {
          events.push(`http:${port}`);
          return { host: "127.0.0.1", port };
        }),
      startPollingLoop: () =>
        Effect.sync(() => {
          events.push("polling");
        }),
      gracefulShutdown: () =>
        Effect.sync(() => {
          events.push("shutdown");
        }),
    };

    await runCliWithNode(
      runCli(["node", "symphony", "./CustomWorkflow.md", "--port", "4123"], (options) =>
        startSymphony(options, actions),
      ),
    );

    expect(events).toEqual([
      "load:./CustomWorkflow.md",
      "build:./CustomWorkflow.md",
      "cleanup-terminal",
      "http:4123",
      "polling",
      "shutdown",
    ]);
  });

  it("defaults to ./WORKFLOW.md and skips the HTTP server when --port is absent", async () => {
    const events: string[] = [];
    const actions: StartupActions<never, Error> = {
      loadWorkflow: (workflowPath) =>
        Effect.sync(() => {
          events.push(`load:${workflowPath}`);
          return loadedConfig;
        }),
      buildLayer: () => Layer.empty,
      cleanupTerminalIssues: () =>
        Effect.sync(() => {
          events.push("cleanup-terminal");
        }),
      startHttpServer: () =>
        Effect.sync(() => {
          events.push("http");
          return { host: "127.0.0.1", port: 0 };
        }),
      startPollingLoop: () =>
        Effect.sync(() => {
          events.push("polling");
        }),
      gracefulShutdown: () =>
        Effect.sync(() => {
          events.push("shutdown");
        }),
    };

    await runCliWithNode(
      runCli(["node", "symphony"], (options) => startSymphony(options, actions)),
    );

    expect(events).toEqual(["load:./WORKFLOW.md", "cleanup-terminal", "polling", "shutdown"]);
  });

  it("runs graceful shutdown when the polling loop is interrupted", async () => {
    const events: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const pollingStarted = yield* Deferred.make<void>();
        const keepPolling = yield* Deferred.make<void>();
        const actions: StartupActions<never, Error> = {
          loadWorkflow: (workflowPath) =>
            Effect.sync(() => {
              events.push(`load:${workflowPath}`);
              return loadedConfig;
            }),
          buildLayer: () => Layer.empty,
          cleanupTerminalIssues: () =>
            Effect.sync(() => {
              events.push("cleanup-terminal");
            }),
          startHttpServer: () =>
            Effect.sync(() => {
              events.push("http");
              return { host: "127.0.0.1", port: 0 };
            }),
          startPollingLoop: () =>
            Effect.sync(() => {
              events.push("polling");
            }).pipe(
              Effect.zipRight(Deferred.succeed(pollingStarted, undefined)),
              Effect.zipRight(Deferred.await(keepPolling)),
            ),
          gracefulShutdown: () =>
            Effect.sync(() => {
              events.push("shutdown");
            }),
        };

        const fiber = yield* Effect.fork(startSymphony({ workflowPath: "./WORKFLOW.md" }, actions));
        yield* Deferred.await(pollingStarted);
        yield* Fiber.interrupt(fiber);
      }),
    );

    expect(events).toEqual(["load:./WORKFLOW.md", "cleanup-terminal", "polling", "shutdown"]);
  });
});
