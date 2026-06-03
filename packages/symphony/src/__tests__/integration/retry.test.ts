import { afterEach, describe, expect, it } from "vitest";
import { createMockAgent, failedTurn, successfulTurn } from "../mocks/agent.js";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Retry on Failure", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("schedules a failed attempt and dispatches it again when due", async () => {
    let now = 1_000;
    const issue = createMockIssue();
    const agent = createMockAgent([failedTurn("first attempt failed")]);
    harness = await createIntegrationHarness({
      issues: [issue],
      agent,
      config: { agent: { max_retry_backoff_ms: 50 } },
      now: () => now,
    });

    await harness.pollOnce();
    const queued = await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);
    expect(queued.retryQueue[0]).toMatchObject({
      issueId: issue.id,
      identifier: issue.identifier,
      attempt: 1,
      dueAt: 1_050,
      error: "Worker agent turn failed for TEST-1: first attempt failed",
    });

    agent.enqueue(() => {
      harness?.tracker.updateIssue(issue.id, { state: "Done" });
      return successfulTurn("retry succeeded");
    });
    now = queued.retryQueue[0]?.dueAt ?? 1_050;

    await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.running.length === 0);

    expect(agent.calls).toHaveLength(2);
    expect(agent.calls[1]?.prompt).toContain("attempt 1");
    expect(finalState.retryQueue).toEqual([]);
    expect(finalState.claims).toEqual([]);
  });
});
