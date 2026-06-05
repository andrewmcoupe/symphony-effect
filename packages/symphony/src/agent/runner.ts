import {
  query as sdkQuery,
  type McpServerConfig,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Context, Effect, Layer } from "effect";
import {
  NonZeroExit,
  OutputParseFailed,
  SpawnFailed,
  TimedOut,
  UnsupportedProvider,
  type AgentError,
} from "./errors.js";
import type { TokenUsage, TurnParams, TurnResult } from "./types.js";

export interface AgentRunner {
  readonly runTurn: (params: TurnParams) => Effect.Effect<TurnResult, AgentError>;
}

export const AgentRunner = Context.GenericTag<AgentRunner>("symphony/AgentRunner");

export type ClaudeQuery = typeof sdkQuery;
export type AgentProvider = "anthropic" | "openai";

export type AgentMcpServerToolPolicy = {
  readonly name: string;
  readonly permission_policy: "always_allow" | "always_ask" | "always_deny";
};

export type AgentMcpServerConfig =
  | {
      readonly type?: "stdio";
      readonly command: string;
      readonly args?: readonly string[] | undefined;
      readonly env?: Readonly<Record<string, string>> | undefined;
      readonly timeout?: number | undefined;
      readonly alwaysLoad?: boolean | undefined;
    }
  | {
      readonly type: "http" | "sse";
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>> | undefined;
      readonly tools?: readonly AgentMcpServerToolPolicy[] | undefined;
      readonly timeout?: number | undefined;
      readonly alwaysLoad?: boolean | undefined;
    };

export interface AgentRunnerConfig {
  readonly provider: AgentProvider;
  readonly maxTurns: number;
  readonly model?: string;
  readonly mcpServers?: Readonly<Record<string, AgentMcpServerConfig>>;
  readonly allowedTools?: readonly string[];
}

interface AgentRunnerDependencies extends AgentRunnerConfig {
  readonly query?: ClaudeQuery;
}

interface AnthropicAgentRunnerDependencies extends Omit<AgentRunnerConfig, "provider"> {
  readonly query?: ClaudeQuery;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const extractTokenUsage = (message: SDKResultMessage): TokenUsage | undefined => {
  const usage: Record<string, unknown> = isRecord(message.usage) ? message.usage : {};
  const inputTokens = numberField(usage.input_tokens);
  const outputTokens = numberField(usage.output_tokens);
  const cacheCreationInputTokens = numberField(usage.cache_creation_input_tokens);
  const cacheReadInputTokens = numberField(usage.cache_read_input_tokens);
  const explicitTotalTokens = numberField(usage.total_tokens);
  const derivedTotalTokens =
    explicitTotalTokens ??
    (inputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cacheReadInputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) +
        (outputTokens ?? 0) +
        (cacheCreationInputTokens ?? 0) +
        (cacheReadInputTokens ?? 0));
  const totalCostUsd = numberField(message.total_cost_usd);
  const tokenUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens }),
    ...(derivedTotalTokens === undefined ? {} : { totalTokens: derivedTotalTokens }),
    ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
  } satisfies TokenUsage;

  return Object.values(tokenUsage).some((value) => value !== undefined) ? tokenUsage : undefined;
};

const isInitMessage = (message: SDKMessage): message is SDKSystemMessage =>
  message.type === "system" && message.subtype === "init";

const isResultMessage = (message: SDKMessage): message is SDKResultMessage =>
  message.type === "result";

const resultOutput = (message: SDKResultMessage): string =>
  message.subtype === "success" ? message.result : message.errors.join("\n");

const resultToTurnResult = (
  message: SDKResultMessage,
  sessionId: string | undefined,
): TurnResult => {
  const success = message.subtype === "success" && message.is_error !== true;
  const tokensUsed = extractTokenUsage(message);

  return {
    success,
    output: resultOutput(message),
    exitCode: success ? 0 : 1,
    sessionId: sessionId ?? message.session_id,
    ...(tokensUsed === undefined ? {} : { tokensUsed }),
  };
};

const unexpectedOutput = (
  workspacePath: string,
  reason: string,
  messages: readonly SDKMessage[],
): OutputParseFailed =>
  new OutputParseFailed({
    workspacePath,
    output: JSON.stringify(messages),
    reason,
  });

const collectQueryResult = async (
  messages: AsyncIterable<SDKMessage>,
  workspacePath: string,
): Promise<TurnResult> => {
  const seen: SDKMessage[] = [];
  let sessionId: string | undefined;
  let result: SDKResultMessage | undefined;

  for await (const message of messages) {
    seen.push(message);

    if (isInitMessage(message)) {
      sessionId = message.session_id;
      continue;
    }

    if (isResultMessage(message)) result = message;
  }

  if (result === undefined) {
    throw unexpectedOutput(workspacePath, "Claude Agent SDK did not emit a result message", seen);
  }

  return resultToTurnResult(result, sessionId);
};

const mapQueryFailure = (workspacePath: string, cause: unknown): AgentError =>
  cause instanceof NonZeroExit || cause instanceof OutputParseFailed
    ? cause
    : new SpawnFailed({
        workspacePath,
        reason: cause instanceof Error ? cause.message : String(cause),
      });

const normalizeMcpServerConfig = (server: AgentMcpServerConfig): McpServerConfig => {
  if ("command" in server) {
    return {
      ...(server.type === undefined ? {} : { type: server.type }),
      command: server.command,
      ...(server.args === undefined ? {} : { args: [...server.args] }),
      ...(server.env === undefined ? {} : { env: { ...server.env } }),
      ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
      ...(server.alwaysLoad === undefined ? {} : { alwaysLoad: server.alwaysLoad }),
    };
  }

  return {
    type: server.type,
    url: server.url,
    ...(server.headers === undefined ? {} : { headers: { ...server.headers } }),
    ...(server.tools === undefined ? {} : { tools: server.tools.map((tool) => ({ ...tool })) }),
    ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
    ...(server.alwaysLoad === undefined ? {} : { alwaysLoad: server.alwaysLoad }),
  };
};

const normalizeMcpServers = (
  servers: Readonly<Record<string, AgentMcpServerConfig>>,
): Record<string, McpServerConfig> =>
  Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, normalizeMcpServerConfig(server)]),
  );

const runCancellableQuery = ({
  allowedTools,
  maxTurns,
  mcpServers,
  model,
  params,
  query,
}: {
  readonly allowedTools?: readonly string[];
  readonly maxTurns: number;
  readonly mcpServers?: Readonly<Record<string, AgentMcpServerConfig>>;
  readonly model?: string;
  readonly params: TurnParams;
  readonly query: ClaudeQuery;
}): Effect.Effect<TurnResult, AgentError> =>
  Effect.async<TurnResult, AgentError>((resume) => {
    const abortController = new AbortController();
    let settled = false;
    const options = {
      cwd: params.workspacePath,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns,
      abortController,
      ...(model === undefined ? {} : { model }),
      ...(mcpServers === undefined ? {} : { mcpServers: normalizeMcpServers(mcpServers) }),
      ...(allowedTools === undefined ? {} : { allowedTools: [...allowedTools] }),
      ...(params.resumeSessionId === undefined ? {} : { resume: params.resumeSessionId }),
    } satisfies ClaudeQueryOptions;

    try {
      void collectQueryResult(query({ prompt: params.prompt, options }), params.workspacePath)
        .then((result) => {
          settled = true;
          resume(Effect.succeed(result));
        })
        .catch((cause: unknown) => {
          settled = true;
          resume(Effect.fail(mapQueryFailure(params.workspacePath, cause)));
        });
    } catch (cause) {
      settled = true;
      resume(Effect.fail(mapQueryFailure(params.workspacePath, cause)));
    }

    return Effect.sync(() => {
      if (!settled) abortController.abort();
    });
  });

export const makeAgentRunner = ({
  allowedTools,
  maxTurns,
  mcpServers,
  model,
  provider,
  query = sdkQuery,
}: AgentRunnerDependencies): AgentRunner => {
  if (provider === "openai") return makeUnsupportedProviderAgentRunner(provider);
  return makeAnthropicAgentRunner({
    ...(allowedTools === undefined ? {} : { allowedTools }),
    maxTurns,
    ...(mcpServers === undefined ? {} : { mcpServers }),
    ...(model === undefined ? {} : { model }),
    query,
  });
};

export const makeAnthropicAgentRunner = ({
  allowedTools,
  maxTurns,
  mcpServers,
  model,
  query = sdkQuery,
}: AnthropicAgentRunnerDependencies): AgentRunner => {
  const runTurn = (params: TurnParams): Effect.Effect<TurnResult, AgentError> =>
    runCancellableQuery({
      ...(allowedTools === undefined ? {} : { allowedTools }),
      maxTurns,
      ...(mcpServers === undefined ? {} : { mcpServers }),
      params,
      query,
      ...(model === undefined ? {} : { model }),
    }).pipe(
      Effect.flatMap((result) =>
        result.success
          ? Effect.succeed(result)
          : Effect.fail(
              new NonZeroExit({
                workspacePath: params.workspacePath,
                exitCode: result.exitCode ?? 1,
                stdout: result.output,
                stderr: result.output,
              }),
            ),
      ),
      Effect.timeoutFail({
        duration: params.timeoutMs,
        onTimeout: () =>
          new TimedOut({ workspacePath: params.workspacePath, timeoutMs: params.timeoutMs }),
      }),
    );

  return { runTurn };
};

const makeUnsupportedProviderAgentRunner = (provider: "openai"): AgentRunner => ({
  runTurn: () => Effect.fail(new UnsupportedProvider({ provider })),
});

export const makeAgentRunnerLive = (config: AgentRunnerConfig): Layer.Layer<AgentRunner> =>
  Layer.succeed(AgentRunner, makeAgentRunner(config));

export const AgentRunnerLive: Layer.Layer<AgentRunner> = makeAgentRunnerLive({
  provider: "anthropic",
  maxTurns: 20,
});

export const NodeAgentRunnerLive: Layer.Layer<AgentRunner> = AgentRunnerLive;

export type { AgentError };
