import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Either } from "effect";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathViolation } from "./errors.js";
import { makeWorkspaceManagerLive, WorkspaceManager } from "./manager.js";

let workspaceRoot: string | undefined;

const runWithWorkspace = <A, E>(effect: Effect.Effect<A, E, WorkspaceManager>) => {
  if (workspaceRoot === undefined) throw new Error("workspaceRoot was not initialized");
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(makeWorkspaceManagerLive(workspaceRoot)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );
};

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "symphony-workspace-"));
});

afterEach(async () => {
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = undefined;
  }
});

describe("WorkspaceManager", () => {
  it("returns a sanitized workspace path under the configured root", async () => {
    const workspacePath = await runWithWorkspace(
      Effect.gen(function* () {
        const manager = yield* WorkspaceManager;
        return yield* manager.getWorkspacePath("ABC/123");
      }),
    );

    expect(workspacePath).toBe(path.join(workspaceRoot as string, "ABC_123"));
  });

  it("creates missing workspaces and reports createdNow", async () => {
    const first = await runWithWorkspace(
      Effect.gen(function* () {
        const manager = yield* WorkspaceManager;
        return yield* manager.ensureWorkspace("ABC-123");
      }),
    );

    expect(first.createdNow).toBe(true);
    await expect(stat(first.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    expect((await stat(first.path)).isDirectory()).toBe(true);

    const second = await runWithWorkspace(
      Effect.gen(function* () {
        const manager = yield* WorkspaceManager;
        return yield* manager.ensureWorkspace("ABC-123");
      }),
    );

    expect(second).toEqual({ path: first.path, createdNow: false });
  });

  it("rejects traversal identifiers", async () => {
    const result = await runWithWorkspace(
      Effect.either(
        Effect.gen(function* () {
          const manager = yield* WorkspaceManager;
          return yield* manager.getWorkspacePath("..");
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PathViolation);
    }
  });

  it("removes existing workspaces recursively", async () => {
    const workspacePath = await runWithWorkspace(
      Effect.gen(function* () {
        const manager = yield* WorkspaceManager;
        const workspace = yield* manager.ensureWorkspace("ABC-123");
        return workspace.path;
      }),
    );
    await writeFile(path.join(workspacePath, "output.txt"), "done");

    await runWithWorkspace(
      Effect.gen(function* () {
        const manager = yield* WorkspaceManager;
        yield* manager.removeWorkspace("ABC-123");
      }),
    );

    await expect(stat(workspacePath)).rejects.toThrow();
  });

  it("lists existing workspace directories only", async () => {
    if (workspaceRoot === undefined) throw new Error("workspaceRoot was not initialized");
    await mkdir(path.join(workspaceRoot, "ABC-1"));
    await mkdir(path.join(workspaceRoot, "ABC_2"));
    await writeFile(path.join(workspaceRoot, "not-a-workspace.txt"), "ignore");

    const directories = await runWithWorkspace(
      Effect.gen(function* () {
        const manager = yield* WorkspaceManager;
        return yield* manager.listWorkspaceDirectories();
      }),
    );

    expect(directories.sort()).toEqual(["ABC-1", "ABC_2"]);
  });

  it("treats removing a missing workspace as successful", async () => {
    await expect(
      runWithWorkspace(
        Effect.gen(function* () {
          const manager = yield* WorkspaceManager;
          yield* manager.removeWorkspace("ABC-404");
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
