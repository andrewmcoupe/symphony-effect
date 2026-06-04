import { homedir } from "node:os";
import { Effect, Either } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { MissingEnvVar, ValidationFailed } from "./errors.js";
import {
  decodeWorkflowConfig,
  expandHome,
  substituteEnvVars,
  type WorkflowConfig,
} from "./schema.js";

const ENV_KEY = "SYMPHONY_TEST_API_KEY";
const GITHUB_ENV_KEY = "SYMPHONY_TEST_GITHUB_TOKEN";

const run = <A, E>(effect: Effect.Effect<A, E>): Either.Either<A, E> =>
  Effect.runSync(Effect.either(effect));

/** A minimal valid raw config with all required fields present. */
const baseRaw = () => ({
  tracker: {
    kind: "linear",
    api_key: "literal-key",
    project_slug: "my-project",
    active_states: ["Todo", "In Progress"],
    terminal_states: ["Done", "Cancelled"],
  },
  workspace: {
    root: "/tmp/symphony-workspaces",
  },
});

afterEach(() => {
  delete process.env[ENV_KEY];
  delete process.env[GITHUB_ENV_KEY];
});

describe("substituteEnvVars", () => {
  it("resolves $VAR and ${VAR} forms", () => {
    const env = { FOO: "foo-value", BAR: "bar-value" };
    expect(substituteEnvVars("$FOO", env)).toEqual({ _tag: "Resolved", value: "foo-value" });
    expect(substituteEnvVars("${BAR}/sub", env)).toEqual({
      _tag: "Resolved",
      value: "bar-value/sub",
    });
    expect(substituteEnvVars("a-$FOO-${BAR}", env)).toEqual({
      _tag: "Resolved",
      value: "a-foo-value-bar-value",
    });
  });

  it("reports the first missing variable", () => {
    expect(substituteEnvVars("$NOPE", {})).toEqual({ _tag: "Missing", name: "NOPE" });
  });

  it("leaves plain strings untouched", () => {
    expect(substituteEnvVars("plain", {})).toEqual({ _tag: "Resolved", value: "plain" });
  });
});

describe("expandHome", () => {
  it("expands a bare ~ and leading ~/", () => {
    expect(expandHome("~", "/home/me")).toBe("/home/me");
    expect(expandHome("~/work", "/home/me")).toBe("/home/me/work");
  });

  it("does not expand ~ in the middle of a path", () => {
    expect(expandHome("/a/~/b", "/home/me")).toBe("/a/~/b");
  });
});

describe("decodeWorkflowConfig", () => {
  it("parses a valid config", () => {
    const result = run(decodeWorkflowConfig(baseRaw()));
    expect(Either.isRight(result)).toBe(true);
    const config = (result as Either.Right<WorkflowConfig>).right;
    expect(config.tracker.kind).toBe("linear");
    expect(config.tracker.api_key).toBe("literal-key");
    expect(config.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(config.workspace.root).toBe("/tmp/symphony-workspaces");
  });

  it("applies all default values", () => {
    const config = (run(decodeWorkflowConfig(baseRaw())) as Either.Right<WorkflowConfig>).right;
    expect(config.tracker.endpoint).toBe("https://api.linear.app/graphql");
    expect(config.polling.interval_ms).toBe(30_000);
    expect(config.git).toBeUndefined();
    expect(config.hooks.timeout_ms).toBe(60_000);
    expect(config.agent.max_concurrent_agents).toBe(10);
    expect(config.agent.max_turns).toBe(20);
    expect(config.agent.model).toBeUndefined();
    expect(config.agent.stall_timeout_ms).toBe(300_000);
    expect(config.agent.max_retry_backoff_ms).toBe(300_000);
  });

  it("honours explicit overrides of defaults", () => {
    const raw = baseRaw();
    const config = (
      run(
        decodeWorkflowConfig({
          ...raw,
          polling: { interval_ms: 5_000 },
          agent: { max_turns: 3, model: "claude-sonnet-4-6" },
        }),
      ) as Either.Right<WorkflowConfig>
    ).right;
    expect(config.polling.interval_ms).toBe(5_000);
    expect(config.agent.max_turns).toBe(3);
    expect(config.agent.model).toBe("claude-sonnet-4-6");
    expect(config.agent.max_concurrent_agents).toBe(10);
    expect(config.agent.stall_timeout_ms).toBe(300_000);
  });

  it("resolves a $VAR reference in api_key", () => {
    process.env[ENV_KEY] = "secret-token";
    const raw = baseRaw();
    raw.tracker.api_key = `$${ENV_KEY}`;
    const config = (run(decodeWorkflowConfig(raw)) as Either.Right<WorkflowConfig>).right;
    expect(config.tracker.api_key).toBe("secret-token");
  });

  it("fails with MissingEnvVar when a referenced var is unset", () => {
    const raw = baseRaw();
    raw.tracker.api_key = `$${ENV_KEY}`;
    const result = run(decodeWorkflowConfig(raw));
    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Left<MissingEnvVar>).left;
    expect(error).toBeInstanceOf(MissingEnvVar);
    expect(error.varName).toBe(ENV_KEY);
  });

  it("expands ~ in workspace.root", () => {
    const raw = baseRaw();
    raw.workspace.root = "~/symphony-workspaces";
    const config = (run(decodeWorkflowConfig(raw)) as Either.Right<WorkflowConfig>).right;
    expect(config.workspace.root).toBe(`${homedir()}/symphony-workspaces`);
  });

  it("rejects an unsupported tracker kind", () => {
    const raw = baseRaw();
    (raw.tracker as { kind: string }).kind = "github";
    const result = run(decodeWorkflowConfig(raw));
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<ValidationFailed>).left).toBeInstanceOf(ValidationFailed);
  });

  it("rejects empty active_states", () => {
    const raw = baseRaw();
    raw.tracker.active_states = [];
    const result = run(decodeWorkflowConfig(raw));
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<ValidationFailed>).left).toBeInstanceOf(ValidationFailed);
  });

  it("rejects a missing required field", () => {
    const raw = baseRaw();
    delete (raw as { workspace?: unknown }).workspace;
    const result = run(decodeWorkflowConfig(raw));
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<ValidationFailed>).left).toBeInstanceOf(ValidationFailed);
  });

  it("parses a valid github git config", () => {
    process.env[GITHUB_ENV_KEY] = "github-token";
    const config = (
      run(
        decodeWorkflowConfig({
          ...baseRaw(),
          git: {
            kind: "github",
            token: `$${GITHUB_ENV_KEY}`,
            repo: "owner/repo",
            api_base_url: "https://github.example.com/api/v3",
            base_branch: "trunk",
            branch_template: "work/{{ issue.identifier }}",
            draft: true,
            title_template: "{{ issue.identifier }}",
            body_template: "{{ issue.url }}",
          },
        }),
      ) as Either.Right<WorkflowConfig>
    ).right;

    expect(config.git).toEqual({
      kind: "github",
      token: "github-token",
      repo: "owner/repo",
      api_base_url: "https://github.example.com/api/v3",
      base_branch: "trunk",
      branch_template: "work/{{ issue.identifier }}",
      draft: true,
      title_template: "{{ issue.identifier }}",
      body_template: "{{ issue.url }}",
    });
  });

  it("applies git config defaults", () => {
    const config = (
      run(
        decodeWorkflowConfig({
          ...baseRaw(),
          git: {
            kind: "github",
            token: "literal-github-token",
            repo: "owner/repo",
          },
        }),
      ) as Either.Right<WorkflowConfig>
    ).right;

    expect(config.git).toEqual({
      kind: "github",
      token: "literal-github-token",
      repo: "owner/repo",
      api_base_url: "https://api.github.com",
      base_branch: "main",
      branch_template: "symphony/{{ issue.identifier }}",
      draft: false,
      title_template: "{{ issue.identifier }}: {{ issue.title }}",
      body_template: "Automated changes for {{ issue.identifier }}.\n\n{{ issue.url }}",
    });
  });

  it("fails with MissingEnvVar when git token references an unset var", () => {
    const result = run(
      decodeWorkflowConfig({
        ...baseRaw(),
        git: {
          kind: "github",
          token: `$${GITHUB_ENV_KEY}`,
          repo: "owner/repo",
        },
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Left<MissingEnvVar>).left;
    expect(error).toBeInstanceOf(MissingEnvVar);
    expect(error.varName).toBe(GITHUB_ENV_KEY);
  });
});
