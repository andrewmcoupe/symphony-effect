import type { Agent as OpenAiAgent, NonStreamRunOptions } from "@openai/agents";
import { Effect, Either, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { NonZeroExit, OutputParseFailed, SpawnFailed, TimedOut } from "./errors.js";
import {
  makeOpenAiAgentRunner,
  type OpenAiConnectMcpServers,
  type OpenAiRun,
  type OpenAiRunResult,
} from "./openai-runner.js";

interface RunCall {
  readonly agent: OpenAiAgent;
  readonly input: string;
  readonly options: NonStreamRunOptions | undefined;
}

const runTurn = (run: OpenAiRun) => {
  const connectMcpServers: OpenAiConnectMcpServers = async (servers) => ({
    active: servers,
    close: async () => undefined,
  });
  const runner = makeOpenAiAgentRunner({
    run,
    connectMcpServers,
    maxTurns: 5,
    model: "gpt-5.1",
    mcpServers: {
      linear: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: {
          Authorization: "Bearer linear-token",
        },
        tools: [
          { name: "safe", permission_policy: "always_allow" },
          { name: "ask", permission_policy: "always_ask" },
          { name: "deny", permission_policy: "always_deny" },
        ],
        timeout: 2_500,
      },
      filesystem: {
        command: "node",
        args: ["server.js"],
        env: { ROOT: "/tmp/symphony" },
      },
    },
    allowedTools: ["mcp__linear__*", "mcp__filesystem__list"],
  });

  return Effect.runPromise(
    Effect.either(
      runner.runTurn({
        prompt: "Fix the auth bug",
        workspacePath: "/tmp/symphony/ABC-123",
        timeoutMs: 100,
        resumeSessionId: "resp-prev",
      }),
    ),
  );
};

const makeFakeRun =
  (result: OpenAiRunResult, calls: RunCall[]): OpenAiRun =>
  async (agent, input, options) => {
    calls.push({ agent, input, options });
    return result;
  };

describe("makeOpenAiAgentRunner", () => {
  it("runs the OpenAI Agents SDK and maps a successful result", async () => {
    const calls: RunCall[] = [];
    const result = await runTurn(
      makeFakeRun(
        {
          finalOutput: "done",
          lastResponseId: "resp-next",
          state: {
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
            },
          },
        },
        calls,
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        success: true,
        output: "done",
        exitCode: 0,
        sessionId: "resp-next",
        tokensUsed: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      });
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("Fix the auth bug");
    expect(calls[0]?.agent.model).toBe("gpt-5.1");
    expect(calls[0]?.agent.mcpServers).toHaveLength(2);
    expect(calls[0]?.agent.mcpConfig).toEqual({ includeServerInToolNames: true });
    expect(calls[0]?.options).toMatchObject({
      maxTurns: 5,
      previousResponseId: "resp-prev",
    });
    expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps snake_case usage fields when SDK usage is serialized", async () => {
    const result = await runTurn(
      makeFakeRun(
        {
          finalOutput: "done",
          lastResponseId: "resp-next",
          state: {
            usage: {
              input_tokens: 12,
              output_tokens: 6,
              total_cost_usd: 0.04,
            },
          },
        },
        [],
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.tokensUsed).toEqual({
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
        totalCostUsd: 0.04,
      });
    }
  });

  it("treats non-interactive tool approval interruptions as NonZeroExit", async () => {
    const result = await runTurn(
      makeFakeRun({ finalOutput: "approval needed", interruptions: [{}] }, []),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(NonZeroExit);
      expect(result.left.stderr).toContain("non-interactive tool approval");
    }
  });

  it("fails with OutputParseFailed when the SDK result has no text final output", async () => {
    const result = await runTurn(makeFakeRun({ lastResponseId: "resp-next" }, []));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(OutputParseFailed);
      expect(result.left.reason).toContain("text final output");
    }
  });

  it("maps SDK startup failures to SpawnFailed", async () => {
    const result = await runTurn(async () => {
      throw new Error("missing OPENAI_API_KEY");
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SpawnFailed);
      expect(result.left.reason).toBe("missing OPENAI_API_KEY");
    }
  });

  it("maps max-turn failures to NonZeroExit", async () => {
    const result = await runTurn(async () => {
      const error = new Error("Max turns exceeded");
      error.name = "MaxTurnsExceededError";
      throw error;
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(NonZeroExit);
      expect(result.left.stderr).toBe("Max turns exceeded");
    }
  });

  it("filters allowed tools and denies always_ask and always_deny policies", async () => {
    const calls: RunCall[] = [];
    await runTurn(makeFakeRun({ finalOutput: "done" }, calls));
    const linear = calls[0]?.agent.mcpServers[0] as { toolFilter?: OpenAiToolFilter } | undefined;

    await expect(linear?.toolFilter?.({} as never, { name: "safe" })).resolves.toBe(true);
    await expect(linear?.toolFilter?.({} as never, { name: "ask" })).resolves.toBe(false);
    await expect(linear?.toolFilter?.({} as never, { name: "deny" })).resolves.toBe(false);
    await expect(linear?.toolFilter?.({} as never, { name: "other" })).resolves.toBe(true);
  });

  it("times out long-running SDK runs and aborts the signal", async () => {
    let aborted = false;
    const runner = makeOpenAiAgentRunner({
      maxTurns: 1,
      run: async (_agent, _input, options) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { finalOutput: "late" };
      },
    });

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
    expect(aborted).toBe(true);
  });

  it("aborts the SDK run on Effect interruption", async () => {
    let aborted = false;
    const runner = makeOpenAiAgentRunner({
      maxTurns: 1,
      run: async (_agent, _input, options) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { finalOutput: "late" };
      },
    });
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

type OpenAiToolFilter = (
  context: never,
  tool: { readonly name: string },
) => Promise<boolean> | boolean;
