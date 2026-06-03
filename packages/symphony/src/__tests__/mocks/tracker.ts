import { Effect } from "effect";
import type { Issue, TrackerClient } from "../../tracker/index.js";

export interface MockTracker extends TrackerClient {
  readonly calls: {
    readonly fetchCandidateIssues: string[];
    readonly fetchIssuesByStates: string[][];
    readonly fetchIssueStatesByIds: string[][];
  };
  readonly getIssue: (id: string) => Issue | undefined;
  readonly setIssues: (nextIssues: readonly Issue[]) => void;
  readonly updateIssue: (id: string, patch: Partial<Issue>) => void;
}

export const createMockIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: "issue-1",
  identifier: "TEST-1",
  title: "Test issue",
  description: "Exercise the integration harness.",
  priority: 1,
  state: "Todo",
  branchName: "test-1",
  url: "https://linear.app/acme/issue/TEST-1",
  labels: [],
  blockedBy: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

export const createMockTracker = (issues: readonly Issue[]): MockTracker => {
  let issueMap = new Map(issues.map((issue) => [issue.id, issue]));

  const calls = {
    fetchCandidateIssues: [] as string[],
    fetchIssuesByStates: [] as string[][],
    fetchIssueStatesByIds: [] as string[][],
  };

  const values = (): Issue[] => Array.from(issueMap.values());

  return {
    calls,
    fetchCandidateIssues: () =>
      Effect.sync(() => {
        calls.fetchCandidateIssues.push("fetchCandidateIssues");
        return values();
      }),
    fetchIssuesByStates: (states) =>
      Effect.sync(() => {
        calls.fetchIssuesByStates.push([...states]);
        const normalized = new Set(states.map((state) => state.trim().toLowerCase()));
        return values().filter((issue) => normalized.has(issue.state.trim().toLowerCase()));
      }),
    fetchIssueStatesByIds: (ids) =>
      Effect.sync(() => {
        calls.fetchIssueStatesByIds.push([...ids]);
        return new Map(
          ids.flatMap((id) => {
            const issue = issueMap.get(id);
            return issue === undefined ? [] : [[id, issue.state] as const];
          }),
        );
      }),
    getIssue: (id) => issueMap.get(id),
    setIssues: (nextIssues) => {
      issueMap = new Map(nextIssues.map((issue) => [issue.id, issue]));
    },
    updateIssue: (id, patch) => {
      const issue = issueMap.get(id);
      if (issue !== undefined) issueMap.set(id, { ...issue, ...patch });
    },
  };
};
