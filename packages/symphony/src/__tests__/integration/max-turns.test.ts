import { afterEach, describe, expect, it } from "vitest";
import { createMockAgent, successfulTurn } from "../mocks/agent.js";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Max Turns Reached", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("ends the worker cleanly and schedules continuation", async () => {
    let now = 5_000;
    const issue = createMockIssue({ state: "Todo" });
    const agent = createMockAgent([successfulTurn("one"), successfulTurn("two")]);
    harness = await createIntegrationHarness({
      issues: [issue],
      agent,
      config: { agent: { max_turns: 2 } },
      now: () => now,
    });

    await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);

    expect(agent.calls).toHaveLength(2);
    expect(finalState.running).toEqual([]);
    expect(finalState.retryQueue).toEqual([
      {
        issueId: issue.id,
        identifier: issue.identifier,
        attempt: 0,
        dueAt: 6_000,
        error: "continuation",
      },
    ]);
  });
});
