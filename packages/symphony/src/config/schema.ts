import { homedir } from "node:os";
import { Effect, ParseResult, Schema } from "effect";
import { MissingEnvVar, ValidationFailed } from "./errors.js";

// ---------------------------------------------------------------------------
// Environment variable + path expansion helpers (pure, env injected)
// ---------------------------------------------------------------------------

/**
 * Sentinel prefix embedded in a {@link ParseResult.Type} message so that a
 * missing-env-var failure can be told apart from an ordinary validation
 * failure after decoding. Env var names cannot contain `:` so this is
 * unambiguous.
 */
const MISSING_ENV_MARKER = "__symphony_missing_env__:";

/** Matches `$VAR` and `${VAR}` references. */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

type Substitution =
  | { readonly _tag: "Resolved"; readonly value: string }
  | { readonly _tag: "Missing"; readonly name: string };

/**
 * Replace every `$VAR` / `${VAR}` reference in `input` with its value from
 * `env`. Returns the first missing variable name if any reference is unset.
 */
export const substituteEnvVars = (
  input: string,
  env: Record<string, string | undefined>,
): Substitution => {
  let missing: string | undefined;
  const value = input.replace(
    ENV_VAR_PATTERN,
    (match, braced: string | undefined, bare: string | undefined) => {
      const name = braced ?? bare ?? "";
      const resolved = env[name];
      if (resolved === undefined) {
        missing ??= name;
        return match;
      }
      return resolved;
    },
  );
  return missing === undefined ? { _tag: "Resolved", value } : { _tag: "Missing", name: missing };
};

/** Expand a leading `~` (home directory) in a filesystem path. */
export const expandHome = (input: string, home: string): string => {
  if (input === "~") return home;
  if (input.startsWith("~/")) return `${home}${input.slice(1)}`;
  return input;
};

const failMissing = (
  ast: ConstructorParameters<typeof ParseResult.Type>[0],
  actual: string,
  name: string,
) => ParseResult.fail(new ParseResult.Type(ast, actual, `${MISSING_ENV_MARKER}${name}`));

/**
 * A string that may contain `$VAR` references, resolved against
 * `process.env` during decoding. Encoding is identity (resolution is lossy).
 */
const EnvString = Schema.transformOrFail(Schema.String, Schema.String, {
  strict: true,
  decode: (raw, _options, ast) => {
    const result = substituteEnvVars(raw, process.env);
    return result._tag === "Missing"
      ? failMissing(ast, raw, result.name)
      : ParseResult.succeed(result.value);
  },
  encode: (value) => ParseResult.succeed(value),
});

/**
 * A filesystem path supporting `$VAR` expansion followed by leading `~`
 * (home directory) expansion.
 */
const PathString = Schema.transformOrFail(Schema.String, Schema.String, {
  strict: true,
  decode: (raw, _options, ast) => {
    const result = substituteEnvVars(raw, process.env);
    return result._tag === "Missing"
      ? failMissing(ast, raw, result.name)
      : ParseResult.succeed(expandHome(result.value, homedir()));
  },
  encode: (value) => ParseResult.succeed(value),
});

const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.positive());

// ---------------------------------------------------------------------------
// Workflow config schema (mirrors PRD §"Config Loader")
// ---------------------------------------------------------------------------

const TrackerConfig = Schema.Struct({
  kind: Schema.Literal("linear"),
  endpoint: Schema.optionalWith(Schema.String, {
    default: () => "https://api.linear.app/graphql",
  }),
  api_key: EnvString,
  project_slug: Schema.String.pipe(Schema.nonEmptyString()),
  active_states: Schema.NonEmptyArray(Schema.String),
  terminal_states: Schema.NonEmptyArray(Schema.String),
});

const PollingConfig = Schema.Struct({
  interval_ms: Schema.optionalWith(PositiveInt, { default: () => 30_000 }),
});

const WorkspaceConfig = Schema.Struct({
  root: PathString,
});

const HooksConfig = Schema.Struct({
  after_create: Schema.optional(Schema.String),
  before_run: Schema.optional(Schema.String),
  after_run: Schema.optional(Schema.String),
  before_remove: Schema.optional(Schema.String),
  timeout_ms: Schema.optionalWith(PositiveInt, { default: () => 60_000 }),
});

const AgentConfig = Schema.Struct({
  max_concurrent_agents: Schema.optionalWith(PositiveInt, { default: () => 10 }),
  max_turns: Schema.optionalWith(PositiveInt, { default: () => 20 }),
  model: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  stall_timeout_ms: Schema.optionalWith(Schema.Number.pipe(Schema.int()), {
    default: () => 300_000,
  }),
  max_retry_backoff_ms: Schema.optionalWith(PositiveInt, { default: () => 300_000 }),
  max_concurrent_agents_by_state: Schema.optional(
    Schema.Record({ key: Schema.String, value: PositiveInt }),
  ),
});

/**
 * The fully validated, defaulted, env-resolved workflow configuration parsed
 * from the YAML front matter of `WORKFLOW.md`.
 */
export const WorkflowConfig = Schema.Struct({
  tracker: TrackerConfig,
  polling: Schema.optionalWith(PollingConfig, { default: () => ({ interval_ms: 30_000 }) }),
  workspace: WorkspaceConfig,
  hooks: Schema.optionalWith(HooksConfig, { default: () => ({ timeout_ms: 60_000 }) }),
  agent: Schema.optionalWith(AgentConfig, {
    default: () => ({
      max_concurrent_agents: 10,
      max_turns: 20,
      stall_timeout_ms: 300_000,
      max_retry_backoff_ms: 300_000,
    }),
  }),
});

export type WorkflowConfig = Schema.Schema.Type<typeof WorkflowConfig>;

// ---------------------------------------------------------------------------
// Decoding with typed errors
// ---------------------------------------------------------------------------

const decode = Schema.decodeUnknown(WorkflowConfig, { errors: "all" });

/**
 * Decode and validate raw config (e.g. parsed YAML front matter) into a typed
 * {@link WorkflowConfig}, applying defaults and resolving `$VAR` / `~`.
 *
 * Fails with {@link MissingEnvVar} when a referenced environment variable is
 * unset, otherwise {@link ValidationFailed} with a human-readable summary.
 */
export const decodeWorkflowConfig = (
  raw: unknown,
): Effect.Effect<WorkflowConfig, MissingEnvVar | ValidationFailed> =>
  decode(raw).pipe(
    Effect.mapError((parseError) => {
      const issues = ParseResult.ArrayFormatter.formatErrorSync(parseError);
      const missing = issues.find((issue) => issue.message.startsWith(MISSING_ENV_MARKER));
      if (missing !== undefined) {
        return new MissingEnvVar({ varName: missing.message.slice(MISSING_ENV_MARKER.length) });
      }
      const reason = issues
        .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      return new ValidationFailed({ reason });
    }),
  );
