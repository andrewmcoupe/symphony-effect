import {
  connectMcpServers as sdkConnectMcpServers,
  MCPServerSSE,
  MCPServerStdio,
  MCPServerStreamableHttp,
  run as sdkRun,
  type Agent as OpenAiAgent,
  type MCPServers,
  type MCPServer,
  type MCPServersOptions,
  type MCPToolFilterCallable,
  type NonStreamRunOptions,
  RunContext,
} from "@openai/agents";
import { localBindMountStrategy, mount, SandboxAgent } from "@openai/agents/sandbox";
import { UnixLocalSandboxClient } from "@openai/agents/sandbox/local";
import { Effect } from "effect";
import {
  NonZeroExit,
  OutputParseFailed,
  SpawnFailed,
  TimedOut,
  type AgentError,
} from "./errors.js";
import type { AgentMcpServerConfig, AgentRunner } from "./runner.js";
import type { TokenUsage, TurnParams, TurnResult } from "./types.js";

export type OpenAiRunResult = {
  readonly finalOutput?: unknown;
  readonly lastResponseId?: string | undefined;
  readonly interruptions?: readonly unknown[];
  readonly state?: {
    readonly usage?: unknown;
  };
  readonly runContext?: {
    readonly usage?: unknown;
  };
};

export type OpenAiRun = (
  agent: OpenAiAgent,
  input: string,
  options?: NonStreamRunOptions,
) => Promise<OpenAiRunResult>;

export type OpenAiConnectMcpServers = (
  servers: MCPServer[],
  options?: MCPServersOptions,
) => Promise<Pick<MCPServers, "active" | "close">>;

interface OpenAiAgentRunnerDependencies {
  readonly maxTurns: number;
  readonly model?: string;
  readonly mcpServers?: Readonly<Record<string, AgentMcpServerConfig>>;
  readonly allowedTools?: readonly string[];
  readonly run?: OpenAiRun;
  readonly connectMcpServers?: OpenAiConnectMcpServers;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const extractTokenUsage = (result: OpenAiRunResult): TokenUsage | undefined => {
  const usage = isRecord(result.state?.usage)
    ? result.state.usage
    : isRecord(result.runContext?.usage)
      ? result.runContext.usage
      : {};
  const inputTokens = numberField(usage.inputTokens) ?? numberField(usage.input_tokens);
  const outputTokens = numberField(usage.outputTokens) ?? numberField(usage.output_tokens);
  const explicitTotalTokens = numberField(usage.totalTokens) ?? numberField(usage.total_tokens);
  const derivedTotalTokens =
    explicitTotalTokens ??
    (inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) + (outputTokens ?? 0));
  const totalCostUsd = numberField(usage.totalCostUsd) ?? numberField(usage.total_cost_usd);
  const tokenUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(derivedTotalTokens === undefined ? {} : { totalTokens: derivedTotalTokens }),
    ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
  } satisfies TokenUsage;

  return Object.values(tokenUsage).some((value) => value !== undefined) ? tokenUsage : undefined;
};

const wildcardToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replaceAll("*", ".*")}$`);

const matchesAnyName = (
  names: readonly string[],
  patterns: readonly string[] | undefined,
): boolean =>
  patterns === undefined ||
  names.some((name) => patterns.some((pattern) => wildcardToRegExp(pattern).test(name)));

const matchesBlockedName = (
  names: readonly string[],
  patterns: readonly string[] | undefined,
): boolean =>
  patterns !== undefined &&
  names.some((name) => patterns.some((pattern) => wildcardToRegExp(pattern).test(name)));

const effectiveToolNames = (serverName: string, toolName: string): readonly string[] => [
  toolName,
  `mcp_${serverName}__${toolName}`,
  `mcp__${serverName}__${toolName}`,
];

const policyBlockedTools = (
  serverName: string,
  server: AgentMcpServerConfig,
  allowedTools: readonly string[] | undefined,
): readonly string[] | undefined => {
  if ("command" in server) return undefined;

  const blocked = (server.tools ?? [])
    .filter(
      (tool) =>
        (tool.permission_policy === "always_ask" || tool.permission_policy === "always_deny") &&
        matchesAnyName(effectiveToolNames(serverName, tool.name), allowedTools),
    )
    .map((tool) => tool.name);

  return blocked.length === 0 ? undefined : blocked;
};

const toolFilter = (
  serverName: string,
  server: AgentMcpServerConfig,
  allowedTools: readonly string[] | undefined,
): MCPToolFilterCallable | undefined => {
  const blockedTools = policyBlockedTools(serverName, server, allowedTools);
  if (allowedTools === undefined && blockedTools === undefined) return undefined;

  return async (_context, tool) => {
    const names = effectiveToolNames(serverName, tool.name);
    return (
      matchesAnyName(names, allowedTools) &&
      !matchesBlockedName(names, blockedTools) &&
      !matchesBlockedName([tool.name], blockedTools)
    );
  };
};

const normalizeTimeoutSeconds = (timeout: number | undefined): number | undefined =>
  timeout === undefined ? undefined : Math.ceil(timeout / 1_000);

const makeMcpServer = (
  name: string,
  server: AgentMcpServerConfig,
  allowedTools: readonly string[] | undefined,
): MCPServer => {
  const timeoutSeconds = normalizeTimeoutSeconds(server.timeout);
  const filter = toolFilter(name, server, allowedTools);
  const common = {
    name,
    ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
    ...(timeoutSeconds === undefined ? {} : { clientSessionTimeoutSeconds: timeoutSeconds }),
    ...(filter === undefined ? {} : { toolFilter: filter }),
  };

  if ("command" in server) {
    return new MCPServerStdio({
      ...common,
      command: server.command,
      ...(server.args === undefined ? {} : { args: [...server.args] }),
      ...(server.env === undefined ? {} : { env: { ...server.env } }),
    });
  }

  if (server.type === "sse") {
    return new MCPServerSSE({
      ...common,
      url: server.url,
      ...(server.headers === undefined ? {} : { requestInit: { headers: { ...server.headers } } }),
    });
  }

  return new MCPServerStreamableHttp({
    ...common,
    url: server.url,
    ...(server.headers === undefined ? {} : { requestInit: { headers: { ...server.headers } } }),
  });
};

const makeMcpServers = (
  servers: Readonly<Record<string, AgentMcpServerConfig>> | undefined,
  allowedTools: readonly string[] | undefined,
): readonly MCPServer[] =>
  servers === undefined
    ? []
    : Object.entries(servers).map(([name, server]) => makeMcpServer(name, server, allowedTools));

const visibleMcpToolsInstruction = (toolNames: readonly string[]): string =>
  toolNames.length === 0
    ? ""
    : ` Available MCP tools: ${toolNames.map((name) => `\`${name}\``).join(", ")}. Use the Linear MCP tools for issue status, checklist, and comment updates before coding.`;

const mapRunResult = (workspacePath: string, result: OpenAiRunResult): TurnResult => {
  if (result.interruptions !== undefined && result.interruptions.length > 0) {
    const output = "OpenAI agent run interrupted for non-interactive tool approval";
    throw new NonZeroExit({ workspacePath, exitCode: 1, stdout: output, stderr: output });
  }

  if (typeof result.finalOutput !== "string") {
    throw new OutputParseFailed({
      workspacePath,
      output: JSON.stringify(result),
      reason: "OpenAI Agents SDK did not emit a text final output",
    });
  }

  const tokensUsed = extractTokenUsage(result);
  return {
    success: true,
    output: result.finalOutput,
    exitCode: 0,
    ...(result.lastResponseId === undefined ? {} : { sessionId: result.lastResponseId }),
    ...(tokensUsed === undefined ? {} : { tokensUsed }),
  };
};

const mapRunFailure = (workspacePath: string, cause: unknown): AgentError => {
  if (
    cause instanceof NonZeroExit ||
    cause instanceof OutputParseFailed ||
    cause instanceof TimedOut
  ) {
    return cause;
  }

  if (cause instanceof Error && cause.name === "MaxTurnsExceededError") {
    return new NonZeroExit({
      workspacePath,
      exitCode: 1,
      stdout: cause.message,
      stderr: cause.message,
    });
  }

  return new SpawnFailed({
    workspacePath,
    reason: cause instanceof Error ? cause.message : String(cause),
  });
};

const runCancellableOpenAi = ({
  allowedTools,
  maxTurns,
  mcpServers,
  model,
  params,
  run,
  connectMcpServers,
}: {
  readonly allowedTools?: readonly string[];
  readonly maxTurns: number;
  readonly mcpServers?: Readonly<Record<string, AgentMcpServerConfig>>;
  readonly model?: string;
  readonly params: TurnParams;
  readonly run: OpenAiRun;
  readonly connectMcpServers: OpenAiConnectMcpServers;
}): Effect.Effect<TurnResult, AgentError> =>
  Effect.async<TurnResult, AgentError>((resume) => {
    const abortController = new AbortController();
    let settled = false;
    const options = {
      maxTurns,
      signal: abortController.signal,
      sandbox: {
        client: new UnixLocalSandboxClient(),
      },
      ...(params.resumeSessionId === undefined
        ? {}
        : { previousResponseId: params.resumeSessionId }),
    } satisfies NonStreamRunOptions;

    const execute = async (): Promise<TurnResult> => {
      const configuredServers = [...makeMcpServers(mcpServers, allowedTools)];
      const connected =
        configuredServers.length === 0
          ? undefined
          : await connectMcpServers(configuredServers, { strict: true, dropFailed: false });

      try {
        const agent = new SandboxAgent({
          name: "Symphony Agent",
          instructions:
            "You are a non-interactive coding agent running inside Symphony. Work in /workspace/repo, complete the requested Turn, and return the final result text.",
          defaultManifest: {
            root: "/workspace",
            entries: {
              repo: mount({
                source: params.workspacePath,
                readOnly: false,
                mountStrategy: localBindMountStrategy(),
              }),
            },
          },
          ...(model === undefined ? {} : { model }),
          mcpServers: connected?.active ?? [],
          mcpConfig: { includeServerInToolNames: true },
        });

        if (configuredServers.length > 0) {
          const toolNames = (await agent.getMcpTools(new RunContext())).map((tool) => tool.name);
          if (toolNames.length === 0) {
            throw new SpawnFailed({
              workspacePath: params.workspacePath,
              reason: "Configured OpenAI MCP servers connected but exposed no tools",
            });
          }

          const instructions = `${agent.instructions ?? ""}${visibleMcpToolsInstruction(toolNames)}`;
          return mapRunResult(
            params.workspacePath,
            await run(agent.clone({ instructions }), params.prompt, options),
          );
        }

        return mapRunResult(params.workspacePath, await run(agent, params.prompt, options));
      } finally {
        await connected?.close().catch(() => undefined);
      }
    };

    try {
      void execute()
        .then((result) => {
          settled = true;
          resume(Effect.succeed(result));
        })
        .catch((cause: unknown) => {
          settled = true;
          resume(Effect.fail(mapRunFailure(params.workspacePath, cause)));
        });
    } catch (cause) {
      settled = true;
      resume(Effect.fail(mapRunFailure(params.workspacePath, cause)));
    }

    return Effect.sync(() => {
      if (!settled) abortController.abort();
    });
  });

export const makeOpenAiAgentRunner = ({
  allowedTools,
  connectMcpServers = sdkConnectMcpServers,
  maxTurns,
  mcpServers,
  model,
  run = sdkRun as OpenAiRun,
}: OpenAiAgentRunnerDependencies): AgentRunner => {
  const runTurn = (params: TurnParams): Effect.Effect<TurnResult, AgentError> =>
    runCancellableOpenAi({
      ...(allowedTools === undefined ? {} : { allowedTools }),
      maxTurns,
      ...(mcpServers === undefined ? {} : { mcpServers }),
      ...(model === undefined ? {} : { model }),
      params,
      run,
      connectMcpServers,
    }).pipe(
      Effect.timeoutFail({
        duration: params.timeoutMs,
        onTimeout: () =>
          new TimedOut({ workspacePath: params.workspacePath, timeoutMs: params.timeoutMs }),
      }),
    );

  return { runTurn };
};
