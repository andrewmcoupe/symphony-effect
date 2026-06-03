import { CommandExecutor } from "@effect/platform/CommandExecutor";
import type {
  CommandExecutor as CommandExecutorService,
  ExitCode,
  Process,
  ProcessId,
} from "@effect/platform/CommandExecutor";
import { makeExecutor } from "@effect/platform/CommandExecutor";
import { Effect, Either, Option, Sink, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { NonZeroExit, OutputParseFailed, TimedOut } from "./errors.js";
import { AgentRunner, AgentRunnerLive } from "./runner.js";

interface FakeCommandExecutorOptions {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly neverExit?: boolean;
  readonly onKill?: () => void;
}

const encoder = new TextEncoder();

const streamFromText = (text: string): Stream.Stream<Uint8Array> =>
  text.length === 0 ? Stream.empty : Stream.make(encoder.encode(text));

const makeFakeExecutor = (
  options: FakeCommandExecutorOptions,
  calls: Array<{
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string | undefined;
  }>,
): CommandExecutorService => {
  let running = true;

  return makeExecutor((command) => {
    if (command._tag !== "StandardCommand") {
      return Effect.dieMessage("expected a standard command");
    }

    calls.push({
      command: command.command,
      args: command.args,
      cwd: Option.getOrUndefined(command.cwd),
    });

    const process = {
      pid: 1 as ProcessId,
      exitCode: options.neverExit
        ? Effect.never
        : Effect.sync(() => {
            running = false;
            return (options.exitCode ?? 0) as ExitCode;
          }),
      isRunning: Effect.sync(() => running),
      kill: () =>
        Effect.sync(() => {
          running = false;
          options.onKill?.();
        }),
      stdout: options.neverExit ? Stream.never : streamFromText(options.stdout ?? ""),
      stdin: Sink.drain,
      stderr: options.neverExit ? Stream.never : streamFromText(options.stderr ?? ""),
      toJSON: () => ({ _id: "Process" }),
      toString: () => "Process",
    } satisfies Process;

    return Effect.succeed(process);
  });
};

const runWithFakeExecutor = (
  options: FakeCommandExecutorOptions,
  calls: Array<{
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string | undefined;
  }>,
) =>
  Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const runner = yield* AgentRunner;
        return yield* runner.runTurn({
          prompt: "Fix the auth bug",
          workspacePath: "/tmp/symphony/ABC-123",
          timeoutMs: 100,
        });
      }).pipe(
        Effect.provide(AgentRunnerLive),
        Effect.provideService(CommandExecutor, makeFakeExecutor(options, calls)),
      ),
    ),
  );

describe("AgentRunner", () => {
  it("runs Claude Code successfully and parses JSON output", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string | undefined;
    }> = [];
    const result = await runWithFakeExecutor(
      {
        stdout: JSON.stringify({
          result: "done",
          is_error: false,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 3,
            total_tokens: 20,
          },
          total_cost_usd: 0.12,
        }),
      },
      calls,
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        success: true,
        output: "done",
        exitCode: 0,
        tokensUsed: {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 2,
          cacheReadInputTokens: 3,
          totalTokens: 20,
          totalCostUsd: 0.12,
        },
      });
    }
    expect(calls).toEqual([
      {
        command: "claude",
        args: ["-p", "Fix the auth bug", "--output-format", "json"],
        cwd: "/tmp/symphony/ABC-123",
      },
    ]);
  });

  it("times out long-running subprocesses", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string | undefined;
    }> = [];
    let killCount = 0;
    const result = await runWithFakeExecutor(
      {
        neverExit: true,
        onKill: () => {
          killCount += 1;
        },
      },
      calls,
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(TimedOut);
    }
    expect(killCount).toBe(1);
  });

  it("fails with NonZeroExit for non-zero subprocess exits", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string | undefined;
    }> = [];
    const result = await runWithFakeExecutor(
      { exitCode: 7, stdout: "partial", stderr: "bad" },
      calls,
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(NonZeroExit);
      expect(result.left.exitCode).toBe(7);
      expect(result.left.stdout).toBe("partial");
      expect(result.left.stderr).toBe("bad");
    }
  });

  it("fails with OutputParseFailed for invalid JSON output", async () => {
    const calls: Array<{
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string | undefined;
    }> = [];
    const result = await runWithFakeExecutor({ stdout: "not-json" }, calls);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OutputParseFailed);
      expect(result.left.output).toBe("not-json");
    }
  });
});
