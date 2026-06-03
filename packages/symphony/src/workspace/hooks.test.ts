import { Effect, Either, Option } from "effect";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HookNonZeroExit, HookTimedOut } from "./errors.js";
import { HookExecutor, NodeHookExecutorLive } from "./hooks.js";

let workspacePath: string | undefined;

const runWithHooks = <A, E>(effect: Effect.Effect<A, E, HookExecutor>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeHookExecutorLive)));

beforeEach(async () => {
  workspacePath = await mkdtemp(path.join(os.tmpdir(), "symphony-hooks-"));
});

afterEach(async () => {
  if (workspacePath !== undefined) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("HookExecutor", () => {
  it("executes hooks successfully and captures stdout and stderr", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");

    const result = await runWithHooks(
      Effect.gen(function* () {
        const hooks = yield* HookExecutor;
        return yield* hooks.executeHook("printf out; printf err >&2", workspacePath, 1_000);
      }),
    );

    expect(result).toEqual({ exitCode: 0, stdout: "out", stderr: "err" });
  });

  it("times out long-running hooks", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");

    const result = await runWithHooks(
      Effect.either(
        Effect.gen(function* () {
          const hooks = yield* HookExecutor;
          return yield* hooks.executeHook("sleep 2", workspacePath, 100);
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HookTimedOut);
    }
  });

  it("fails with HookNonZeroExit for non-zero hook exits", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");

    const result = await runWithHooks(
      Effect.either(
        Effect.gen(function* () {
          const hooks = yield* HookExecutor;
          return yield* hooks.executeHook(
            "printf nope; printf bad >&2; exit 7",
            workspacePath,
            1_000,
          );
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HookNonZeroExit);
      expect(result.left.exitCode).toBe(7);
      expect(result.left.stdout).toBe("nope");
      expect(result.left.stderr).toBe("bad");
    }
  });

  it("uses the workspace path as the working directory", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");
    await writeFile(path.join(workspacePath, "marker.txt"), "present");

    const result = await runWithHooks(
      Effect.gen(function* () {
        const hooks = yield* HookExecutor;
        return yield* hooks.executeHook("pwd; test -f marker.txt", workspacePath, 1_000);
      }),
    );

    expect(result.stdout.trim()).toBe(await realpath(workspacePath));
  });

  it("passes issue and workspace environment variables to hooks", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");

    const result = await runWithHooks(
      Effect.gen(function* () {
        const hooks = yield* HookExecutor;
        return yield* hooks.executeHook(
          'printf \'%s|%s\' "$ISSUE_IDENTIFIER" "$WORKSPACE_PATH"',
          workspacePath,
          1_000,
          { issueIdentifier: "ABC-123" },
        );
      }),
    );

    expect(result.stdout).toBe(`ABC-123|${workspacePath}`);
  });

  it("propagates fatal lifecycle hook failures", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");

    const result = await runWithHooks(
      Effect.either(
        Effect.gen(function* () {
          const hooks = yield* HookExecutor;
          return yield* hooks.executeLifecycleHook({
            hook: "exit 9",
            hookName: "before_run",
            workspacePath,
            timeoutMs: 1_000,
          });
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HookNonZeroExit);
    }
  });

  it("logs and ignores best-effort lifecycle hook failures", async () => {
    if (workspacePath === undefined) throw new Error("workspacePath was not initialized");

    const result = await runWithHooks(
      Effect.gen(function* () {
        const hooks = yield* HookExecutor;
        return yield* hooks.executeLifecycleHook({
          hook: "exit 9",
          hookName: "after_run",
          workspacePath,
          timeoutMs: 1_000,
        });
      }),
    );

    expect(Option.isNone(result)).toBe(true);
  });
});
