import type { Fiber } from "effect";

export type WorkerError = {
  readonly _tag: string;
  readonly message?: string;
};

export type IssueClaimState =
  | { readonly _tag: "Unclaimed" }
  | { readonly _tag: "Claimed"; readonly claimedAt: number }
  | {
      readonly _tag: "Running";
      readonly fiber: Fiber.RuntimeFiber<void, WorkerError>;
      readonly startedAt: number;
      readonly turnCount: number;
      readonly lastActivityAt: number;
      readonly attempt?: number;
      readonly trackerState?: string;
    }
  | {
      readonly _tag: "RetryQueued";
      readonly attempt: number;
      readonly dueAt: number;
      readonly error: string;
    };

export interface RetryEntry {
  readonly issueId: string;
  readonly identifier: string;
  readonly attempt: number;
  readonly dueAt: number;
  readonly error: string;
}

export interface TokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly runtimeSeconds: number;
}

export interface RunningIssue {
  readonly issueId: string;
  readonly identifier: string;
  readonly fiber: Fiber.RuntimeFiber<void, WorkerError>;
  readonly startedAt: number;
  readonly turnCount: number;
  readonly lastActivityAt: number;
  readonly attempt?: number;
  readonly trackerState?: string;
}

export interface OrchestratorState {
  readonly running: Map<string, RunningIssue>;
  readonly retryQueue: ReadonlyArray<RetryEntry>;
  readonly tokenTotals: TokenTotals;
  readonly lastPollAt: number | null;
  readonly claims?: Map<string, IssueClaimState>;
  readonly identifiers?: Map<string, string>;
}

export interface TokenUsageDelta {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly runtimeSeconds?: number;
}

export interface MarkRetryQueuedOptions {
  readonly dueAt?: number;
  readonly identifier?: string;
}

export interface RunningIssueSnapshot {
  readonly issueId: string;
  readonly identifier: string;
  readonly trackerState?: string;
  readonly turnCount: number;
  readonly startedAt: number;
  readonly elapsedMs: number;
  readonly lastActivityAt: number;
}

export type IssueClaimSnapshot =
  | { readonly issueId: string; readonly _tag: "Unclaimed" }
  | {
      readonly issueId: string;
      readonly _tag: "Claimed";
      readonly claimedAt: number;
      readonly identifier: string;
    }
  | {
      readonly issueId: string;
      readonly _tag: "Running";
      readonly startedAt: number;
      readonly turnCount: number;
      readonly lastActivityAt: number;
      readonly identifier: string;
      readonly trackerState?: string;
    }
  | {
      readonly issueId: string;
      readonly _tag: "RetryQueued";
      readonly attempt: number;
      readonly dueAt: number;
      readonly error: string;
      readonly identifier: string;
    };

export interface OrchestratorSnapshot {
  readonly running: ReadonlyArray<RunningIssueSnapshot>;
  readonly retryQueue: ReadonlyArray<RetryEntry>;
  readonly tokenTotals: TokenTotals;
  readonly lastPollAt: number | null;
  readonly claims: ReadonlyArray<IssueClaimSnapshot>;
}
