import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import path from "node:path";
import {
  CreationFailed,
  ListingFailed,
  PathViolation,
  RemovalFailed,
  type WorkspaceError,
} from "./errors.js";
import { sanitizeIdentifier } from "./sanitize.js";
import type {
  WorkspaceInfo,
  WorkspaceManagerConfig as WorkspaceManagerConfigValue,
} from "./types.js";

export interface WorkspaceManager {
  readonly getWorkspacePath: (identifier: string) => Effect.Effect<string, PathViolation>;
  readonly listWorkspaceDirectories: () => Effect.Effect<string[], ListingFailed>;
  readonly ensureWorkspace: (
    identifier: string,
  ) => Effect.Effect<WorkspaceInfo, CreationFailed | PathViolation>;
  readonly removeWorkspace: (
    identifier: string,
  ) => Effect.Effect<void, PathViolation | RemovalFailed>;
}

export const WorkspaceManager = Context.GenericTag<WorkspaceManager>("symphony/WorkspaceManager");

export const WorkspaceManagerConfig = Context.GenericTag<WorkspaceManagerConfigValue>(
  "symphony/WorkspaceManagerConfig",
);

const formatPlatformError = (error: { readonly message: string }): string => error.message;

const isTraversalSegment = (segment: string): boolean => segment === "." || segment === "..";

const isUnderRoot = (resolvedRoot: string, resolvedPath: string): boolean =>
  resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`);

export const makeWorkspaceManager = ({
  root,
  fileSystem,
}: WorkspaceManagerConfigValue & {
  readonly fileSystem: FileSystem.FileSystem;
}): WorkspaceManager => {
  const resolvedRoot = path.resolve(root);

  const getWorkspacePath = (identifier: string): Effect.Effect<string, PathViolation> => {
    const sanitized = sanitizeIdentifier(identifier);
    const workspacePath = path.resolve(resolvedRoot, sanitized);

    if (isTraversalSegment(sanitized) || !isUnderRoot(resolvedRoot, workspacePath)) {
      return Effect.fail(
        new PathViolation({ root: resolvedRoot, path: workspacePath, identifier }),
      );
    }

    return Effect.succeed(workspacePath);
  };

  const ensureWorkspace = (
    identifier: string,
  ): Effect.Effect<WorkspaceInfo, CreationFailed | PathViolation> =>
    Effect.gen(function* () {
      const workspacePath = yield* getWorkspacePath(identifier);
      const exists = yield* fileSystem
        .exists(workspacePath)
        .pipe(
          Effect.mapError(
            (error) =>
              new CreationFailed({ path: workspacePath, reason: formatPlatformError(error) }),
          ),
        );

      if (!exists) {
        yield* fileSystem
          .makeDirectory(workspacePath, { recursive: true })
          .pipe(
            Effect.mapError(
              (error) =>
                new CreationFailed({ path: workspacePath, reason: formatPlatformError(error) }),
            ),
          );
      }

      return { path: workspacePath, createdNow: !exists };
    });

  const listWorkspaceDirectories = (): Effect.Effect<string[], ListingFailed> =>
    Effect.gen(function* () {
      const names = yield* fileSystem
        .readDirectory(resolvedRoot)
        .pipe(
          Effect.mapError(
            (error) =>
              new ListingFailed({ path: resolvedRoot, reason: formatPlatformError(error) }),
          ),
        );

      const directories = yield* Effect.forEach(names, (name) =>
        fileSystem.stat(path.join(resolvedRoot, name)).pipe(
          Effect.map((info) => (info.type === "Directory" ? name : undefined)),
          Effect.mapError(
            (error) =>
              new ListingFailed({ path: resolvedRoot, reason: formatPlatformError(error) }),
          ),
        ),
      );

      return directories.filter((name): name is string => name !== undefined).sort();
    });

  const removeWorkspace = (
    identifier: string,
  ): Effect.Effect<void, PathViolation | RemovalFailed> =>
    Effect.gen(function* () {
      const workspacePath = yield* getWorkspacePath(identifier);
      yield* fileSystem
        .remove(workspacePath, { recursive: true, force: true })
        .pipe(
          Effect.mapError(
            (error) =>
              new RemovalFailed({ path: workspacePath, reason: formatPlatformError(error) }),
          ),
        );
    });

  return { getWorkspacePath, listWorkspaceDirectories, ensureWorkspace, removeWorkspace };
};

export const WorkspaceManagerLive: Layer.Layer<
  WorkspaceManager,
  never,
  WorkspaceManagerConfigValue | FileSystem.FileSystem
> = Layer.effect(
  WorkspaceManager,
  Effect.gen(function* () {
    const config = yield* WorkspaceManagerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    return makeWorkspaceManager({ root: config.root, fileSystem });
  }),
);

export const makeWorkspaceManagerLive = (
  root: string,
): Layer.Layer<WorkspaceManager, never, FileSystem.FileSystem> =>
  WorkspaceManagerLive.pipe(Layer.provide(Layer.succeed(WorkspaceManagerConfig, { root })));

export const makeNodeWorkspaceManagerLive = (root: string): Layer.Layer<WorkspaceManager> =>
  makeWorkspaceManagerLive(root).pipe(Layer.provide(NodeFileSystem.layer));

export type { WorkspaceError };
