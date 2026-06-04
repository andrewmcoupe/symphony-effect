import {
  ConfigLoader,
  ConfigLoaderLive,
  PromptRenderer,
  PromptRendererLive,
} from "../../config/index.js";
import {
  ConcurrencyController,
  makeConcurrencyControllerLive,
} from "../../orchestrator/concurrency.js";
import {
  makeOrchestrator,
  type Orchestrator,
  type PollTickResult,
} from "../../orchestrator/orchestrator.js";
import { makeReconciler } from "../../orchestrator/reconciliation.js";
import {
  OrchestratorStateRef,
  OrchestratorStateRefLive,
  type OrchestratorSnapshot,
} from "../../orchestrator/state/index.js";
import type { WorkflowConfig } from "../../config/index.js";
import type { HookExecutorService } from "../../workspace/index.js";
import type { Issue } from "../../tracker/index.js";
import { Effect, Option } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockAgent, type MockAgent } from "../mocks/agent.js";
import { createMockGitProvider, type MockGitProvider } from "../mocks/git.js";
import { createMockTracker, type MockTracker } from "../mocks/tracker.js";
import { createTempWorkspace, type TempWorkspace } from "../mocks/workspace.js";
import { waitForState as waitForReadState } from "./assertions.js";

type WorkflowConfigOverrides = {
  readonly tracker?: Partial<WorkflowConfig["tracker"]>;
  readonly polling?: Partial<WorkflowConfig["polling"]>;
  readonly workspace?: Partial<WorkflowConfig["workspace"]>;
  readonly git?: Partial<NonNullable<WorkflowConfig["git"]>>;
  readonly hooks?: Partial<WorkflowConfig["hooks"]>;
  readonly agent?: Partial<WorkflowConfig["agent"]>;
};

export interface IntegrationHarness {
  readonly agent: MockAgent;
  readonly cleanup: () => Promise<void>;
  readonly gitProvider: MockGitProvider;
  readonly hookCalls: string[];
  readonly orchestrator: Orchestrator;
  readonly pollOnce: () => Promise<PollTickResult>;
  readonly readSnapshot: () => Promise<OrchestratorSnapshot>;
  readonly rewriteWorkflow: (config?: WorkflowConfigOverrides, prompt?: string) => Promise<void>;
  readonly stateRef: OrchestratorStateRef;
  readonly tempRoot: string;
  readonly tracker: MockTracker;
  readonly waitForState: (
    predicate: (snapshot: OrchestratorSnapshot) => boolean,
    options?: { readonly timeoutMs?: number; readonly intervalMs?: number },
  ) => Promise<OrchestratorSnapshot>;
  readonly workflowPath: string;
  readonly workspace: TempWorkspace;
}

export const makeWorkflowConfig = (
  workspaceRoot: string,
  overrides: WorkflowConfigOverrides = {},
): WorkflowConfig => {
  const git =
    overrides.git === undefined
      ? {}
      : {
          git: {
            kind: "github" as const,
            token: "github-token",
            repo: "acme/repo",
            api_base_url: "https://api.github.com",
            base_branch: "main",
            branch_template: "symphony/{{ issue.identifier }}",
            draft: false,
            title_template: "{{ issue.identifier }}: {{ issue.title }}",
            body_template: "Automated changes for {{ issue.identifier }}.\n\n{{ issue.url }}",
            ...overrides.git,
          },
        };

  return {
    tracker: {
      kind: "linear",
      endpoint: "https://linear.example/graphql",
      api_key: "test-token",
      project_slug: "project",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
      ...overrides.tracker,
    },
    polling: {
      interval_ms: 25,
      ...overrides.polling,
    },
    workspace: {
      root: workspaceRoot,
      ...overrides.workspace,
    },
    ...git,
    hooks: {
      timeout_ms: 1_000,
      ...overrides.hooks,
    },
    agent: {
      max_concurrent_agents: 2,
      max_turns: 3,
      stall_timeout_ms: 300_000,
      max_retry_backoff_ms: 10_000,
      ...overrides.agent,
    },
  };
};

const indentList = (values: readonly string[]): string =>
  values.map((value) => `    - ${value}`).join("\n");

const yamlString = (value: string): string => JSON.stringify(value);

export const workflowMarkdown = (
  config: WorkflowConfig,
  prompt = "Work on {{ issue.identifier }} attempt {{ attempt | default: 'first' }}",
): string => {
  const perStateLimits = config.agent.max_concurrent_agents_by_state;
  const yamlKey = (key: string): string =>
    /^[A-Za-z0-9_-]+$/u.test(key) ? key : JSON.stringify(key);
  const perState =
    perStateLimits === undefined
      ? ""
      : [
          "  max_concurrent_agents_by_state:",
          ...Object.entries(perStateLimits).map(([state, max]) => `    ${yamlKey(state)}: ${max}`),
        ].join("\n");
  const git =
    config.git === undefined
      ? ""
      : [
          "git:",
          "  kind: github",
          `  token: ${yamlString(config.git.token)}`,
          `  repo: ${yamlString(config.git.repo)}`,
          `  api_base_url: ${yamlString(config.git.api_base_url)}`,
          `  base_branch: ${yamlString(config.git.base_branch)}`,
          `  branch_template: ${yamlString(config.git.branch_template)}`,
          `  draft: ${config.git.draft}`,
          `  title_template: ${yamlString(config.git.title_template)}`,
          `  body_template: ${yamlString(config.git.body_template)}`,
        ].join("\n");

  return [
    "---",
    "tracker:",
    "  kind: linear",
    `  endpoint: ${config.tracker.endpoint}`,
    `  api_key: ${config.tracker.api_key}`,
    `  project_slug: ${config.tracker.project_slug}`,
    "  active_states:",
    indentList(config.tracker.active_states),
    "  terminal_states:",
    indentList(config.tracker.terminal_states),
    "polling:",
    `  interval_ms: ${config.polling.interval_ms}`,
    "workspace:",
    `  root: ${config.workspace.root}`,
    git,
    "hooks:",
    `  timeout_ms: ${config.hooks.timeout_ms}`,
    config.hooks.after_create === undefined ? "" : `  after_create: ${config.hooks.after_create}`,
    config.hooks.before_run === undefined ? "" : `  before_run: ${config.hooks.before_run}`,
    config.hooks.after_run === undefined ? "" : `  after_run: ${config.hooks.after_run}`,
    config.hooks.before_remove === undefined
      ? ""
      : `  before_remove: ${config.hooks.before_remove}`,
    "agent:",
    `  max_concurrent_agents: ${config.agent.max_concurrent_agents}`,
    `  max_turns: ${config.agent.max_turns}`,
    `  stall_timeout_ms: ${config.agent.stall_timeout_ms}`,
    `  max_retry_backoff_ms: ${config.agent.max_retry_backoff_ms}`,
    perState,
    "---",
    prompt,
  ]
    .filter((line) => line !== "")
    .join("\n");
};

const makeHookExecutor = (hookCalls: string[]): HookExecutorService => ({
  executeHook: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
  executeLifecycleHook: ({ hookName, hook }) =>
    Effect.sync(() => {
      hookCalls.push(hookName);
      return hook === undefined
        ? Option.none()
        : Option.some({ exitCode: 0, stdout: "", stderr: "" });
    }),
});

export const createIntegrationHarness = async ({
  issues = [],
  agent = createMockAgent(),
  gitProvider = createMockGitProvider(),
  config,
  now = Date.now,
  prompt,
}: {
  readonly issues?: readonly Issue[];
  readonly agent?: MockAgent;
  readonly gitProvider?: MockGitProvider;
  readonly config?: WorkflowConfigOverrides;
  readonly now?: () => number;
  readonly prompt?: string;
} = {}): Promise<IntegrationHarness> => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "symphony-project-"));
  const workspace = await createTempWorkspace(path.join(tempRoot, "workspaces"));
  const workflowPath = path.join(tempRoot, "WORKFLOW.md");
  const initialConfig = makeWorkflowConfig(workspace.root, config);
  await writeFile(workflowPath, workflowMarkdown(initialConfig, prompt));

  const tracker = createMockTracker(issues);
  const hookCalls: string[] = [];
  const hookExecutor = makeHookExecutor(hookCalls);

  const services = await Effect.runPromise(
    Effect.gen(function* () {
      const loader = yield* ConfigLoader;
      const promptRenderer = yield* PromptRenderer;
      const stateRef = yield* OrchestratorStateRef;
      const concurrency = yield* ConcurrencyController;
      const reconciler = makeReconciler({
        hookExecutor,
        now,
        stateRef,
        tracker,
        workspaceManager: workspace.manager,
      });
      return { concurrency, loader, promptRenderer, reconciler, stateRef };
    }).pipe(
      Effect.provide(makeConcurrencyControllerLive(initialConfig.agent)),
      Effect.provide(OrchestratorStateRefLive),
      Effect.provide(ConfigLoaderLive),
      Effect.provide(PromptRendererLive),
    ),
  );

  const orchestrator = makeOrchestrator({
    workflowPath,
    now,
    agent,
    concurrency: services.concurrency,
    hookExecutor,
    gitProvider,
    loader: services.loader,
    promptRenderer: services.promptRenderer,
    reconciler: services.reconciler,
    stateRef: services.stateRef,
    tracker,
    workspaceManager: workspace.manager,
  });

  const readSnapshot = () => Effect.runPromise(services.stateRef.getSnapshot());

  return {
    agent,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
    gitProvider,
    hookCalls,
    orchestrator,
    pollOnce: () => Effect.runPromise(orchestrator.pollOnce()),
    readSnapshot,
    rewriteWorkflow: async (overrides = {}, nextPrompt = prompt) => {
      await writeFile(
        workflowPath,
        workflowMarkdown(makeWorkflowConfig(workspace.root, overrides), nextPrompt),
      );
    },
    stateRef: services.stateRef,
    tempRoot,
    tracker,
    waitForState: (predicate, options) => waitForReadState(readSnapshot, predicate, options),
    workflowPath,
    workspace,
  };
};
