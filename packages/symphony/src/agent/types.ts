export interface TurnParams {
  readonly prompt: string;
  readonly workspacePath: string;
  readonly timeoutMs: number;
}

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly totalTokens?: number;
  readonly totalCostUsd?: number;
}

export interface TurnResult {
  readonly success: boolean;
  readonly output: string;
  readonly exitCode: number;
  readonly tokensUsed?: TokenUsage;
}
