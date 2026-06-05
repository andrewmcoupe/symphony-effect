import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "./config/index.js";
import { GitProvider } from "./git/index.js";
import { HttpServer } from "./observability/index.js";
import { Orchestrator, OrchestratorRefresh, OrchestratorStateRef } from "./orchestrator/index.js";
import { TrackerClient } from "./tracker/index.js";
import { HookExecutor, WorkspaceManager } from "./workspace/index.js";
import { makeMainLive } from "./layers.js";

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

describe("makeMainLive", () => {
  it("provides the services used during startup", async () => {
    const services = await Effect.runPromise(
      Effect.gen(function* () {
        yield* HookExecutor;
        yield* GitProvider;
        yield* HttpServer;
        yield* Orchestrator;
        yield* OrchestratorRefresh;
        yield* OrchestratorStateRef;
        yield* TrackerClient;
        yield* WorkspaceManager;
        return true;
      }).pipe(
        Effect.provide(
          makeMainLive({ loaded: loadedConfig, workflowPath: "/tmp/symphony/WORKFLOW.md" }),
        ),
      ),
    );

    expect(services).toBe(true);
  });
});
