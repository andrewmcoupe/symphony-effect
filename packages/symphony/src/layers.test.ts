import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { MissingEnvVar, type LoadedConfig } from "./config/index.js";
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

const withEnv = async <A>(
  values: Readonly<Record<string, string | undefined>>,
  run: () => Promise<A>,
): Promise<A> => {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]] as const),
  );

  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

const provideStartupServices = (loaded: LoadedConfig) =>
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
  }).pipe(Effect.provide(makeMainLive({ loaded, workflowPath: "/tmp/symphony/WORKFLOW.md" })));

describe("makeMainLive", () => {
  it("provides the services used during startup", async () => {
    const services = await withEnv({ ANTHROPIC_API_KEY: "anthropic-key" }, () =>
      Effect.runPromise(provideStartupServices(loadedConfig)),
    );

    expect(services).toBe(true);
  });

  it("fails at startup when the selected Anthropic provider key is missing", async () => {
    const result = await withEnv({ ANTHROPIC_API_KEY: undefined }, () =>
      Effect.runPromise(Effect.either(provideStartupServices(loadedConfig))),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(MissingEnvVar);
      expect(result.left.varName).toBe("ANTHROPIC_API_KEY");
    }
  });

  it("requires OPENAI_API_KEY only when the OpenAI provider is selected", async () => {
    const openAiConfig: LoadedConfig = {
      ...loadedConfig,
      config: {
        ...loadedConfig.config,
        agent: {
          ...loadedConfig.config.agent,
          provider: "openai",
          model: "gpt-5.1",
        },
      },
    };

    const missing = await withEnv(
      { ANTHROPIC_API_KEY: "anthropic-key", OPENAI_API_KEY: undefined },
      () => Effect.runPromise(Effect.either(provideStartupServices(openAiConfig))),
    );

    expect(Either.isLeft(missing)).toBe(true);
    if (Either.isLeft(missing)) {
      expect(missing.left).toBeInstanceOf(MissingEnvVar);
      expect(missing.left.varName).toBe("OPENAI_API_KEY");
    }

    const provided = await withEnv(
      { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: "openai-key" },
      () => Effect.runPromise(Effect.either(provideStartupServices(openAiConfig))),
    );

    expect(Either.isRight(provided)).toBe(true);
  });
});
