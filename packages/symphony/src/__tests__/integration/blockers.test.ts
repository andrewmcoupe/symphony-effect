import { afterEach, describe, expect, it } from "vitest";
import { createMockAgent, successfulTurn } from "../mocks/agent.js";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Blocker Handling", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("waits for non-terminal blockers before dispatching a Todo issue", async () => {
    const blocked = createMockIssue({
      id: "blocked",
      identifier: "TEST-1",
      blockedBy: [{ id: "blocker", identifier: "TEST-0", state: "Todo" }],
    });
    const agent = createMockAgent([
      () => {
        harness?.tracker.updateIssue(blocked.id, { state: "Done" });
        return successfulTurn("unblocked");
      },
    ]);
    harness = await createIntegrationHarness({ issues: [blocked], agent });

    await harness.pollOnce();
    expect(agent.calls).toHaveLength(0);
    expect((await harness.readSnapshot()).running).toEqual([]);

    harness.tracker.updateIssue(blocked.id, {
      blockedBy: [{ id: "blocker", identifier: "TEST-0", state: "Done" }],
    });

    await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.running.length === 0);

    expect(agent.calls).toHaveLength(1);
    expect(finalState.retryQueue).toEqual([]);
  });
});
