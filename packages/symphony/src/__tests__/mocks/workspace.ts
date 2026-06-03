import { Effect } from "effect";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CreationFailed,
  ListingFailed,
  PathViolation,
  RemovalFailed,
  sanitizeIdentifier,
  type WorkspaceManagerService,
} from "../../workspace/index.js";

export interface TempWorkspace {
  readonly root: string;
  readonly manager: WorkspaceManagerService;
  readonly pathFor: (identifier: string) => string;
  readonly cleanup: () => Promise<void>;
}

const isUnderRoot = (root: string, child: string): boolean =>
  child === root || child.startsWith(`${root}${path.sep}`);

export const createTempWorkspace = async (root?: string): Promise<TempWorkspace> => {
  const workspaceRoot = path.resolve(root ?? (await mkdtemp(path.join(tmpdir(), "symphony-it-"))));
  await mkdir(workspaceRoot, { recursive: true });

  const pathFor = (identifier: string): string =>
    path.resolve(workspaceRoot, sanitizeIdentifier(identifier));

  const getWorkspacePath = (identifier: string) => {
    const workspacePath = pathFor(identifier);
    return isUnderRoot(workspaceRoot, workspacePath)
      ? Effect.succeed(workspacePath)
      : Effect.fail(new PathViolation({ root: workspaceRoot, path: workspacePath, identifier }));
  };

  const manager: WorkspaceManagerService = {
    getWorkspacePath,
    ensureWorkspace: (identifier) =>
      Effect.tryPromise({
        try: async () => {
          const workspacePath = pathFor(identifier);
          if (!isUnderRoot(workspaceRoot, workspacePath)) {
            throw new PathViolation({ root: workspaceRoot, path: workspacePath, identifier });
          }
          let createdNow = false;
          try {
            await stat(workspacePath);
          } catch {
            await mkdir(workspacePath, { recursive: true });
            createdNow = true;
          }
          return { path: workspacePath, createdNow };
        },
        catch: (cause) =>
          cause instanceof PathViolation
            ? cause
            : new CreationFailed({
                path: pathFor(identifier),
                reason: cause instanceof Error ? cause.message : String(cause),
              }),
      }),
    listWorkspaceDirectories: () =>
      Effect.tryPromise({
        try: async () => {
          const entries = await readdir(workspaceRoot);
          const directories = await Promise.all(
            entries.map(async (entry) => {
              const entryPath = path.join(workspaceRoot, entry);
              return (await stat(entryPath)).isDirectory() ? entry : undefined;
            }),
          );
          return directories.filter((entry): entry is string => entry !== undefined).sort();
        },
        catch: (cause) =>
          new ListingFailed({
            path: workspaceRoot,
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
    removeWorkspace: (identifier) =>
      Effect.gen(function* () {
        const workspacePath = yield* getWorkspacePath(identifier);
        yield* Effect.tryPromise({
          try: () => rm(workspacePath, { recursive: true, force: true }),
          catch: (cause) =>
            new RemovalFailed({
              path: workspacePath,
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      }),
  };

  return {
    root: workspaceRoot,
    manager,
    pathFor,
    cleanup: () => rm(workspaceRoot, { recursive: true, force: true }),
  };
};
