import type {
  Options as ClaudeQueryOptions,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Effect, Either, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { NonZeroExit, OutputParseFailed, SpawnFailed, TimedOut } from "./errors.js";
import { type ClaudeQuery, makeAgentRunner } from "./runner.js";

interface QueryCall {
  readonly prompt: string;
  readonly options: ClaudeQueryOptions | undefined;
}

const initMessage = (sessionId = "session-1"): SDKMessage =>
  ({
    type: "system",
    subtype: "init",
    session_id: sessionId,
  }) as SDKMessage;

const resultMessage = ({
  isError = false,
  output = "done",
  sessionId = "session-1",
}: {
  readonly isError?: boolean;
  readonly output?: string;
  readonly sessionId?: string;
} = {}): SDKResultMessage =>
  ({
    type: "result",
    subtype: isError ? "error_during_execution" : "success",
    is_error: isError,
    result: isError ? undefined : output,
    errors: isError ? [output] : undefined,
    session_id: sessionId,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
    },
    total_cost_usd: 0.12,
  }) as SDKResultMessage;

const streamMessages = (messages: readonly SDKMessage[]): ReturnType<ClaudeQuery> =>
  (async function* () {
    for (const message of messages) yield message;
  })() as ReturnType<ClaudeQuery>;

const makeFakeQuery = (messages: readonly SDKMessage[], calls: QueryCall[]): ClaudeQuery =>
  ((params) => {
    calls.push(params);
    return streamMessages(messages);
  }) as ClaudeQuery;

const runTurn = (query: ClaudeQuery) => {
  const runner = makeAgentRunner({
    query,
    maxTurns: 7,
    model: "claude-sonnet-4-6",
  });

  return Effect.runPromise(
    Effect.either(
      runner.runTurn({
        prompt: "Fix the auth bug",
        workspacePath: "/tmp/symphony/ABC-123",
        timeoutMs: 100,
        resumeSessionId: "resume-session",
      }),
    ),
  );
};

describe("AgentRunner", () => {
  it("runs the Claude Agent SDK and maps a successful result", async () => {
    const calls: QueryCall[] = [];
    const result = await runTurn(makeFakeQuery([initMessage(), resultMessage()], calls));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        success: true,
        output: "done",
        exitCode: 0,
        sessionId: "session-1",
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

    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe("Fix the auth bug");
    expect(calls[0]?.options).toMatchObject({
      cwd: "/tmp/symphony/ABC-123",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 7,
      model: "claude-sonnet-4-6",
      resume: "resume-session",
    });
    expect(calls[0]?.options?.abortController).toBeInstanceOf(AbortController);
  });

  it("fails with NonZeroExit for SDK error results", async () => {
    const result = await runTurn(
      makeFakeQuery([initMessage(), resultMessage({ isError: true, output: "tool failed" })], []),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(NonZeroExit);
      expect(result.left.exitCode).toBe(1);
      expect(result.left.stderr).toBe("tool failed");
    }
  });

  it("fails with OutputParseFailed when no result message is emitted", async () => {
    const result = await runTurn(makeFakeQuery([initMessage()], []));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OutputParseFailed);
      expect(result.left.reason).toContain("did not emit a result message");
    }
  });

  it("maps synchronous SDK startup failures to SpawnFailed", async () => {
    const query = (() => {
      throw new Error("could not start Claude");
    }) as ClaudeQuery;
    const result = await runTurn(query);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SpawnFailed);
      expect(result.left.reason).toBe("could not start Claude");
    }
  });

  it("times out long-running SDK sessions and aborts the controller", async () => {
    let abortCount = 0;
    const query = (({ options }) => {
      options?.abortController?.signal.addEventListener("abort", () => {
        abortCount += 1;
      });

      return (async function* () {
        await new Promise<void>((resolve) => {
          options?.abortController?.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        yield* [];
      })() as ReturnType<ClaudeQuery>;
    }) as ClaudeQuery;

    const runner = makeAgentRunner({ query, maxTurns: 1 });
    const result = await Effect.runPromise(
      Effect.either(
        runner.runTurn({
          prompt: "hang",
          workspacePath: "/tmp/symphony/ABC-123",
          timeoutMs: 10,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(TimedOut);
    expect(abortCount).toBe(1);
  });

  it("aborts the SDK session on Effect interruption", async () => {
    let aborted = false;
    const query = (({ options }) => {
      options?.abortController?.signal.addEventListener("abort", () => {
        aborted = true;
      });

      return (async function* () {
        await new Promise<void>((resolve) => {
          options?.abortController?.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        yield* [];
      })() as ReturnType<ClaudeQuery>;
    }) as ClaudeQuery;

    const runner = makeAgentRunner({ query, maxTurns: 1 });
    const fiber = Effect.runFork(
      runner.runTurn({
        prompt: "hang",
        workspacePath: "/tmp/symphony/ABC-123",
        timeoutMs: 10_000,
      }),
    );

    await Effect.runPromise(Effect.sleep("10 millis"));
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(aborted).toBe(true);
  });
});
