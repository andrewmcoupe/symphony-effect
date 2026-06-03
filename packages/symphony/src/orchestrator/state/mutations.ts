import type {
  IssueClaimSnapshot,
  IssueClaimState,
  OrchestratorSnapshot,
  OrchestratorState,
  RetryEntry,
  RunningIssue,
  RunningIssueSnapshot,
  TokenTotals,
  TokenUsageDelta,
} from "./types.js";

export const initialTokenTotals: TokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  runtimeSeconds: 0,
};

export const initialOrchestratorState: OrchestratorState = {
  running: new Map(),
  retryQueue: [],
  tokenTotals: initialTokenTotals,
  lastPollAt: null,
  claims: new Map(),
  identifiers: new Map(),
};

const copyState = (state: OrchestratorState): OrchestratorState => ({
  running: new Map(state.running),
  retryQueue: [...state.retryQueue],
  tokenTotals: { ...state.tokenTotals },
  lastPollAt: state.lastPollAt,
  claims: new Map(state.claims ?? []),
  identifiers: new Map(state.identifiers ?? []),
});

const getIdentifier = (state: OrchestratorState, issueId: string, fallback?: string): string => {
  const running = state.running.get(issueId);
  if (running !== undefined) return running.identifier;

  const identifier = state.identifiers?.get(issueId);
  if (identifier !== undefined) return identifier;

  const retry = state.retryQueue.find((entry) => entry.issueId === issueId);
  return retry?.identifier ?? fallback ?? issueId;
};

export const claimIssueMutation =
  (issueId: string, identifier = issueId, now = Date.now()) =>
  (state: OrchestratorState): OrchestratorState => {
    const next = copyState(state);
    next.identifiers?.set(issueId, identifier);
    next.claims?.set(issueId, { _tag: "Claimed", claimedAt: now });
    return next;
  };

export const markRunningMutation =
  (issue: RunningIssue) =>
  (state: OrchestratorState): OrchestratorState => {
    const next = copyState(state);
    next.running.set(issue.issueId, issue);
    next.identifiers?.set(issue.issueId, issue.identifier);
    next.claims?.set(issue.issueId, {
      _tag: "Running",
      fiber: issue.fiber,
      startedAt: issue.startedAt,
      turnCount: issue.turnCount,
      lastActivityAt: issue.lastActivityAt,
      ...(issue.trackerState === undefined ? {} : { trackerState: issue.trackerState }),
    });
    return {
      ...next,
      retryQueue: next.retryQueue.filter((entry) => entry.issueId !== issue.issueId),
    };
  };

export const markRetryQueuedMutation =
  (entry: RetryEntry) =>
  (state: OrchestratorState): OrchestratorState => {
    const next = copyState(state);
    next.running.delete(entry.issueId);
    const retryQueue = [
      ...next.retryQueue.filter((existing) => existing.issueId !== entry.issueId),
      entry,
    ].sort((left, right) => left.dueAt - right.dueAt);
    next.identifiers?.set(entry.issueId, entry.identifier);
    next.claims?.set(entry.issueId, {
      _tag: "RetryQueued",
      attempt: entry.attempt,
      dueAt: entry.dueAt,
      error: entry.error,
    });
    return { ...next, retryQueue };
  };

export const releaseIssueMutation =
  (issueId: string) =>
  (state: OrchestratorState): OrchestratorState => {
    const next = copyState(state);
    next.identifiers?.delete(issueId);
    next.claims?.delete(issueId);
    next.running.delete(issueId);
    return {
      ...next,
      retryQueue: next.retryQueue.filter((entry) => entry.issueId !== issueId),
    };
  };

export const updateActivityMutation =
  (issueId: string, now = Date.now()) =>
  (state: OrchestratorState): OrchestratorState => {
    const running = state.running.get(issueId);
    if (running === undefined) return state;

    const next = copyState(state);
    const updated: RunningIssue = { ...running, lastActivityAt: now };
    next.running.set(issueId, updated);
    next.claims?.set(issueId, {
      _tag: "Running",
      fiber: updated.fiber,
      startedAt: updated.startedAt,
      turnCount: updated.turnCount,
      lastActivityAt: updated.lastActivityAt,
      ...(updated.trackerState === undefined ? {} : { trackerState: updated.trackerState }),
    });
    return next;
  };

export const incrementTokensMutation =
  (usage: TokenUsageDelta) =>
  (state: OrchestratorState): OrchestratorState => {
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
    const runtimeSeconds = usage.runtimeSeconds ?? 0;

    return {
      ...state,
      tokenTotals: {
        inputTokens: state.tokenTotals.inputTokens + inputTokens,
        outputTokens: state.tokenTotals.outputTokens + outputTokens,
        totalTokens: state.tokenTotals.totalTokens + totalTokens,
        runtimeSeconds: state.tokenTotals.runtimeSeconds + runtimeSeconds,
      },
    };
  };

export const recordPollMutation =
  (lastPollAt = Date.now()) =>
  (state: OrchestratorState): OrchestratorState => ({ ...state, lastPollAt });

const toClaimSnapshot = (
  issueId: string,
  claim: IssueClaimState,
  identifier = issueId,
): IssueClaimSnapshot => {
  switch (claim._tag) {
    case "Unclaimed":
      return { issueId, _tag: "Unclaimed" };
    case "Claimed":
      return {
        issueId,
        _tag: "Claimed",
        claimedAt: claim.claimedAt,
        identifier,
      };
    case "Running":
      return {
        issueId,
        _tag: "Running",
        startedAt: claim.startedAt,
        turnCount: claim.turnCount,
        lastActivityAt: claim.lastActivityAt,
        identifier,
        ...(claim.trackerState === undefined ? {} : { trackerState: claim.trackerState }),
      };
    case "RetryQueued":
      return {
        issueId,
        _tag: "RetryQueued",
        attempt: claim.attempt,
        dueAt: claim.dueAt,
        error: claim.error,
        identifier,
      };
  }
};

const toRunningSnapshot =
  (now: number) =>
  (issue: RunningIssue): RunningIssueSnapshot => ({
    issueId: issue.issueId,
    identifier: issue.identifier,
    ...(issue.trackerState === undefined ? {} : { trackerState: issue.trackerState }),
    turnCount: issue.turnCount,
    startedAt: issue.startedAt,
    elapsedMs: Math.max(0, now - issue.startedAt),
    lastActivityAt: issue.lastActivityAt,
  });

export const getSnapshot = (state: OrchestratorState, now = Date.now()): OrchestratorSnapshot => ({
  running: Array.from(state.running.values()).map(toRunningSnapshot(now)),
  retryQueue: [...state.retryQueue],
  tokenTotals: { ...state.tokenTotals },
  lastPollAt: state.lastPollAt,
  claims: Array.from((state.claims ?? new Map()).entries()).map(([issueId, claim]) =>
    toClaimSnapshot(issueId, claim, state.identifiers?.get(issueId)),
  ),
});

export const resolveIssueIdentifier = getIdentifier;
