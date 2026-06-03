import { Command } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import {
  CommandExecutor as CommandExecutorTag,
  type CommandExecutor as CommandExecutorService,
} from "@effect/platform/CommandExecutor";
import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node";
import { Chunk, Context, Effect, Layer, Option, Stream } from "effect";
import path from "node:path";
import { HookExecutionFailed, HookNonZeroExit, HookTimedOut, type HookError } from "./errors.js";
import type { HookExecutionResult, HookName } from "./types.js";

export interface ExecuteHookOptions {
  readonly issueIdentifier?: string;
}

export interface ExecuteLifecycleHookOptions extends ExecuteHookOptions {
  readonly hook: string | undefined;
  readonly hookName: HookName;
  readonly workspacePath: string;
  readonly timeoutMs: number;
}

export interface HookExecutor {
  readonly executeHook: (
    hook: string,
    workspacePath: string,
    timeoutMs: number,
    options?: ExecuteHookOptions,
  ) => Effect.Effect<HookExecutionResult, HookError>;
  readonly executeLifecycleHook: (
    options: ExecuteLifecycleHookOptions,
  ) => Effect.Effect<Option.Option<HookExecutionResult>, HookError>;
}

export const HookExecutor = Context.GenericTag<HookExecutor>("symphony/HookExecutor");

const ignoredHookNames = new Set<HookName>(["after_run", "before_remove"]);

export const isIgnoredHook = (hookName: HookName): boolean => ignoredHookNames.has(hookName);

const formatPlatformError = (error: PlatformError): string => error.message;

const collectText = (
  stream: Stream.Stream<Uint8Array, PlatformError>,
): Effect.Effect<string, PlatformError> =>
  stream.pipe(Stream.decodeText(), Stream.runCollect, Effect.map(Chunk.join("")));

const issueIdentifierFromWorkspace = (workspacePath: string): string =>
  path.basename(workspacePath);

const buildCommand = (
  hook: string,
  workspacePath: string,
  issueIdentifier: string,
): Command.Command =>
  Command.make("sh", "-lc", hook).pipe(
    Command.workingDirectory(workspacePath),
    Command.env({
      ISSUE_IDENTIFIER: issueIdentifier,
      WORKSPACE_PATH: workspacePath,
    }),
  );

export const makeHookExecutor = (commandExecutor: CommandExecutorService): HookExecutor => {
  const executeHook = (
    hook: string,
    workspacePath: string,
    timeoutMs: number,
    options: ExecuteHookOptions = {},
  ): Effect.Effect<HookExecutionResult, HookError> => {
    const issueIdentifier = options.issueIdentifier ?? issueIdentifierFromWorkspace(workspacePath);
    const command = buildCommand(hook, workspacePath, issueIdentifier);
    const timedOut = () => new HookTimedOut({ hook, workspacePath, timeoutMs });

    return Effect.scoped(
      Effect.gen(function* () {
        const process = yield* Command.start(command);
        const output = yield* Effect.all(
          {
            exitCode: process.exitCode,
            stdout: collectText(process.stdout),
            stderr: collectText(process.stderr),
          },
          { concurrency: "unbounded" },
        );
        const result = {
          exitCode: output.exitCode as number,
          stdout: output.stdout,
          stderr: output.stderr,
        };

        if (result.exitCode !== 0) {
          return yield* Effect.fail(new HookNonZeroExit({ hook, workspacePath, ...result }));
        }

        return result;
      }).pipe(Effect.provideService(CommandExecutorTag, commandExecutor)),
    ).pipe(
      Effect.mapError((error) =>
        error instanceof HookNonZeroExit
          ? error
          : new HookExecutionFailed({
              hook,
              workspacePath,
              reason: formatPlatformError(error),
            }),
      ),
      Effect.timeoutFail({ duration: timeoutMs, onTimeout: timedOut }),
    );
  };

  const executeLifecycleHook = ({
    hook,
    hookName,
    workspacePath,
    timeoutMs,
    issueIdentifier,
  }: ExecuteLifecycleHookOptions): Effect.Effect<Option.Option<HookExecutionResult>, HookError> => {
    if (hook === undefined) return Effect.succeed(Option.none());

    const executeOptions = issueIdentifier === undefined ? {} : { issueIdentifier };
    const effect = executeHook(hook, workspacePath, timeoutMs, executeOptions).pipe(
      Effect.map(Option.some),
    );

    if (!isIgnoredHook(hookName)) return effect;

    return effect.pipe(
      Effect.tapError((error) => Effect.logWarning(error.message)),
      Effect.catchAll(() => Effect.succeed(Option.none())),
    );
  };

  return { executeHook, executeLifecycleHook };
};

export const HookExecutorLive: Layer.Layer<HookExecutor, never, CommandExecutorService> =
  Layer.effect(
    HookExecutor,
    Effect.gen(function* () {
      const commandExecutor = yield* CommandExecutorTag;
      return makeHookExecutor(commandExecutor);
    }),
  );

export const NodeHookExecutorLive: Layer.Layer<HookExecutor> = HookExecutorLive.pipe(
  Layer.provide(NodeCommandExecutor.layer),
  Layer.provide(NodeFileSystem.layer),
);

export type { HookError };
