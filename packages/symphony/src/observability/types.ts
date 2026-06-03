export interface StateSnapshot {
  readonly running: {
    readonly issueId: string;
    readonly identifier: string;
    readonly turnCount: number;
    readonly startedAt: string;
    readonly elapsedMs: number;
    readonly state: string;
  }[];
  readonly retrying: {
    readonly issueId: string;
    readonly identifier: string;
    readonly attempt: number;
    readonly dueAt: string;
    readonly error: string;
  }[];
  readonly tokenTotals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly runtimeSeconds: number;
  };
  readonly config: {
    readonly pollingIntervalMs: number;
    readonly maxConcurrentAgents: number;
  };
  readonly lastPollAt: string | null;
  readonly shutdownRequested: boolean;
}

export interface IssueDetail {
  readonly identifier: string;
  readonly status: "running" | "retrying" | "idle";
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
}

export interface HttpServerStartOptions {
  readonly port: number;
  readonly host?: string;
}

export interface HttpServerBinding {
  readonly host: string;
  readonly port: number;
}
