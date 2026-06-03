import { Command } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import {
  CommandExecutor as CommandExecutorTag,
  type CommandExecutor as CommandExecutorService,
  type Process,
} from "@effect/platform/CommandExecutor";
import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node";
import { Chunk, Context, Effect, Layer, Stream } from "effect";
import {
  NonZeroExit,
  OutputParseFailed,
  SpawnFailed,
  TimedOut,
  type AgentError,
} from "./errors.js";
import type { TokenUsage, TurnParams, TurnResult } from "./types.js";

export interface AgentRunner {
  readonly runTurn: (params: TurnParams) => Effect.Effect<TurnResult, AgentError>;
}

export const AgentRunner = Context.GenericTag<AgentRunner>("symphony/AgentRunner");

interface ClaudeJsonOutput {
  readonly result?: unknown;
  readonly is_error?: unknown;
  readonly subtype?: unknown;
  readonly usage?: unknown;
  readonly total_cost_usd?: unknown;
}

const formatPlatformError = (error: PlatformError): string => error.message;

const collectText = (
  stream: Stream.Stream<Uint8Array, PlatformError>,
): Effect.Effect<string, PlatformError> =>
  stream.pipe(Stream.decodeText(), Stream.runCollect, Effect.map(Chunk.join("")));

const buildCommand = ({ prompt, workspacePath }: TurnParams): Command.Command =>
  Command.make("claude", "-p", prompt, "--output-format", "json").pipe(
    Command.workingDirectory(workspacePath),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const extractTokenUsage = (payload: ClaudeJsonOutput): TokenUsage | undefined => {
  const usage = isRecord(payload.usage) ? payload.usage : {};
  const inputTokens = numberField(usage.input_tokens);
  const outputTokens = numberField(usage.output_tokens);
  const cacheCreationInputTokens = numberField(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = numberField(usage.cache_read_input_tokens);
  const totalTokens = numberField(usage.total_tokens);
  const totalCostUsd = numberField(payload.total_cost_usd);
  const tokenUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
  } satisfies TokenUsage;

  return Object.values(tokenUsage).some((value) => value !== undefined) ? tokenUsage : undefined;
};

const outputFromPayload = (payload: ClaudeJsonOutput): string => {
  if (typeof payload.result === "string") return payload.result;
  if (payload.result !== undefined) return JSON.stringify(payload.result);
  return JSON.stringify(payload);
};

const parseClaudeOutput = (
  stdout: string,
  workspacePath: string,
  exitCode: number,
): Effect.Effect<TurnResult, OutputParseFailed> =>
  Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(stdout);

      if (!isRecord(parsed)) {
        throw new Error("expected a JSON object");
      }

      const payload = parsed as ClaudeJsonOutput;
      const tokensUsed = extractTokenUsage(payload);

      return {
        success: payload.is_error !== true && payload.subtype !== "error",
        output: outputFromPayload(payload),
        exitCode,
        ...(tokensUsed === undefined ? {} : { tokensUsed }),
      };
    },
    catch: (cause) =>
      new OutputParseFailed({
        workspacePath,
        output: stdout,
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const killIfRunning = (process: Process): Effect.Effect<void, never> =>
  process.isRunning.pipe(
    Effect.flatMap((running) => (running ? process.kill("SIGTERM") : Effect.void)),
    Effect.catchAll(() => Effect.void),
  );

export const makeAgentRunner = (commandExecutor: CommandExecutorService): AgentRunner => {
  const runTurn = (params: TurnParams): Effect.Effect<TurnResult, AgentError> => {
    const command = buildCommand(params);
    const timedOut = () =>
      new TimedOut({ workspacePath: params.workspacePath, timeoutMs: params.timeoutMs });

    return Effect.scoped(
      Effect.gen(function* () {
        const process = yield* Command.start(command);
        yield* Effect.addFinalizer(() => killIfRunning(process));

        const output = yield* Effect.all(
          {
            exitCode: process.exitCode,
            stdout: collectText(process.stdout),
            stderr: collectText(process.stderr),
          },
          { concurrency: "unbounded" },
        );
        const exitCode = output.exitCode as number;

        if (exitCode !== 0) {
          return yield* Effect.fail(
            new NonZeroExit({
              workspacePath: params.workspacePath,
              exitCode,
              stdout: output.stdout,
              stderr: output.stderr,
            }),
          );
        }

        return yield* parseClaudeOutput(output.stdout, params.workspacePath, exitCode);
      }).pipe(Effect.provideService(CommandExecutorTag, commandExecutor)),
    ).pipe(
      Effect.mapError((error) =>
        error instanceof NonZeroExit || error instanceof OutputParseFailed
          ? error
          : new SpawnFailed({
              workspacePath: params.workspacePath,
              reason: formatPlatformError(error),
            }),
      ),
      Effect.timeoutFail({ duration: params.timeoutMs, onTimeout: timedOut }),
    );
  };

  return { runTurn };
};

export const AgentRunnerLive: Layer.Layer<AgentRunner, never, CommandExecutorService> =
  Layer.effect(
    AgentRunner,
    Effect.gen(function* () {
      const commandExecutor = yield* CommandExecutorTag;
      return makeAgentRunner(commandExecutor);
    }),
  );

export const NodeAgentRunnerLive: Layer.Layer<AgentRunner> = AgentRunnerLive.pipe(
  Layer.provide(NodeCommandExecutor.layer),
  Layer.provide(NodeFileSystem.layer),
);

export type { AgentError };
