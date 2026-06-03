import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import matter from "gray-matter";
import YAML from "yaml";
import { FileNotFound, type MissingEnvVar, ParseFailed, type ValidationFailed } from "./errors.js";
import { decodeWorkflowConfig, type WorkflowConfig } from "./schema.js";

/** The result of loading a `WORKFLOW.md`: typed config plus its prompt body. */
export interface LoadedConfig {
  readonly config: WorkflowConfig;
  readonly promptTemplate: string;
}

/**
 * Split a raw `WORKFLOW.md` into its parsed YAML front matter and prompt body.
 *
 * `gray-matter` handles the `---` fence extraction; the `yaml` package does the
 * actual YAML parsing (per PRD) via a custom engine so syntax errors surface as
 * {@link ParseFailed} rather than `gray-matter`'s default `js-yaml`.
 */
const parseFrontMatter = (
  path: string,
  raw: string,
): Effect.Effect<{ data: unknown; content: string }, ParseFailed> =>
  Effect.try({
    try: () => {
      const parsed = matter(raw, {
        engines: { yaml: (input: string) => YAML.parse(input) as object },
      });
      return { data: parsed.data, content: parsed.content.trim() };
    },
    catch: (cause) =>
      new ParseFailed({ path, reason: cause instanceof Error ? cause.message : String(cause) }),
  });

/**
 * Loads and parses `WORKFLOW.md` files into a typed {@link WorkflowConfig} and
 * prompt template. Backed by `@effect/platform` {@link FileSystem.FileSystem};
 * provide a mock filesystem layer to test in isolation.
 */
export class ConfigLoader extends Effect.Service<ConfigLoader>()("symphony/ConfigLoader", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    /**
     * Read, parse and validate the workflow file at `path`. The config is
     * re-read on every call (no caching) so the orchestrator picks up edits on
     * each polling tick.
     */
    const load = (
      path: string,
    ): Effect.Effect<LoadedConfig, FileNotFound | ParseFailed | MissingEnvVar | ValidationFailed> =>
      Effect.gen(function* () {
        const raw = yield* fs
          .readFileString(path)
          .pipe(Effect.mapError((error) => new FileNotFound({ path, reason: error.message })));
        const { data, content } = yield* parseFrontMatter(path, raw);
        const config = yield* decodeWorkflowConfig(data);
        return { config, promptTemplate: content };
      });

    return { load } as const;
  }),
}) {}

/**
 * Live {@link ConfigLoader} backed by the Node filesystem. Provides everything
 * needed to run `ConfigLoader.load` in a real runtime.
 */
export const ConfigLoaderLive: Layer.Layer<ConfigLoader> = ConfigLoader.Default.pipe(
  Layer.provide(NodeFileSystem.layer),
);
