import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Effect, Either, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { FileNotFound, MissingEnvVar, ParseFailed, ValidationFailed } from "./errors.js";
import { ConfigLoader } from "./loader.js";

const ENV_KEY = "SYMPHONY_TEST_API_KEY";

/**
 * A minimal {@link FileSystem.FileSystem} whose `readFileString` is backed by an
 * in-memory map. Only the method exercised by {@link ConfigLoader.load} is
 * implemented; the rest are unused in these tests.
 */
const mockFileSystem = (files: Record<string, string>): Layer.Layer<FileSystem.FileSystem> =>
  Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.FileSystem.of({
      readFileString: (path: string) =>
        Object.prototype.hasOwnProperty.call(files, path)
          ? Effect.succeed(files[path] as string)
          : Effect.fail(
              new SystemError({
                reason: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: path,
                description: `No such file: ${path}`,
              }),
            ),
    } as unknown as FileSystem.FileSystem),
  );

/** Run `load(path)` against an in-memory filesystem, capturing success/failure. */
const loadFrom = (files: Record<string, string>, path: string) =>
  Effect.runSync(
    Effect.either(
      Effect.gen(function* () {
        const loader = yield* ConfigLoader;
        return yield* loader.load(path);
      }).pipe(Effect.provide(ConfigLoader.Default), Effect.provide(mockFileSystem(files))),
    ),
  );

const PATH = "/work/WORKFLOW.md";

const validFrontMatter = (apiKey = "literal-key") => `---
tracker:
  kind: linear
  api_key: ${apiKey}
  project_slug: my-project
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled
workspace:
  root: /tmp/symphony-workspaces
---
You are working on {{ issue.identifier }}.
`;

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("ConfigLoader.load", () => {
  it("loads a valid workflow file, returning config and prompt template", () => {
    const result = loadFrom({ [PATH]: validFrontMatter() }, PATH);
    expect(Either.isRight(result)).toBe(true);
    const { config, promptTemplate } = (result as Either.Right<never>).right;
    expect(config.tracker.kind).toBe("linear");
    expect(config.tracker.api_key).toBe("literal-key");
    expect(config.tracker.project_slug).toBe("my-project");
    expect(config.workspace.root).toBe("/tmp/symphony-workspaces");
    expect(promptTemplate).toBe("You are working on {{ issue.identifier }}.");
  });

  it("fails with FileNotFound when the file is missing", () => {
    const result = loadFrom({}, PATH);
    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Left<FileNotFound>).left;
    expect(error).toBeInstanceOf(FileNotFound);
    expect(error.path).toBe(PATH);
  });

  it("fails with ParseFailed on invalid YAML front matter", () => {
    const broken = `---
tracker: : not valid
  api_key: [unclosed
---
body
`;
    const result = loadFrom({ [PATH]: broken }, PATH);
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<ParseFailed>).left).toBeInstanceOf(ParseFailed);
  });

  it("fails with ValidationFailed when the config shape is invalid", () => {
    const missingWorkspace = `---
tracker:
  kind: linear
  api_key: literal-key
  project_slug: my-project
  active_states:
    - Todo
  terminal_states:
    - Done
---
body
`;
    const result = loadFrom({ [PATH]: missingWorkspace }, PATH);
    expect(Either.isLeft(result)).toBe(true);
    expect((result as Either.Left<ValidationFailed>).left).toBeInstanceOf(ValidationFailed);
  });

  it("fails with MissingEnvVar when a referenced env var is unset", () => {
    const result = loadFrom({ [PATH]: validFrontMatter(`$${ENV_KEY}`) }, PATH);
    expect(Either.isLeft(result)).toBe(true);
    const error = (result as Either.Left<MissingEnvVar>).left;
    expect(error).toBeInstanceOf(MissingEnvVar);
    expect(error.varName).toBe(ENV_KEY);
  });

  it("resolves a referenced env var in api_key", () => {
    process.env[ENV_KEY] = "secret-token";
    const result = loadFrom({ [PATH]: validFrontMatter(`$${ENV_KEY}`) }, PATH);
    expect(Either.isRight(result)).toBe(true);
    expect((result as Either.Right<never>).right.config.tracker.api_key).toBe("secret-token");
  });

  it("tolerates an empty prompt template", () => {
    const withFrontMatterOnly = `---
tracker:
  kind: linear
  api_key: literal-key
  project_slug: my-project
  active_states:
    - Todo
  terminal_states:
    - Done
workspace:
  root: /tmp/ws
---
`;
    const result = loadFrom({ [PATH]: withFrontMatterOnly }, PATH);
    expect(Either.isRight(result)).toBe(true);
    expect((result as Either.Right<never>).right.promptTemplate).toBe("");
  });
});
