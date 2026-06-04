export interface AgentOutput {
  readonly issueId: string;
  readonly identifier: string;
  readonly turnNumber: number;
  readonly recordedAt: string;
  readonly output: string;
}

export interface RunningIssue {
  readonly issueId: string;
  readonly identifier: string;
  readonly turnCount: number;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly state: string;
  readonly latestAgentOutput?: AgentOutput;
}

export interface RetryEntry {
  readonly issueId: string;
  readonly identifier: string;
  readonly attempt: number;
  readonly dueAt: string;
  readonly error: string;
}

export interface TokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly runtimeSeconds: number;
}

export interface StateSnapshot {
  readonly running: RunningIssue[];
  readonly retrying: RetryEntry[];
  readonly tokenTotals: TokenTotals;
  readonly config: {
    readonly pollingIntervalMs: number;
    readonly maxConcurrentAgents: number;
  };
  readonly lastPollAt: string | null;
  readonly shutdownRequested: boolean;
  readonly agentOutputs: AgentOutput[];
}

export interface IssueDetail {
  readonly identifier: string;
  readonly status: "running" | "retrying" | "idle";
  readonly state?: string;
  readonly running?: {
    readonly turnCount: number;
    readonly startedAt: string;
    readonly elapsedMs: number;
  };
  readonly retry?: {
    readonly attempt: number;
    readonly dueAt: string;
    readonly error: string;
  };
  readonly agentOutputs: AgentOutput[];
}
