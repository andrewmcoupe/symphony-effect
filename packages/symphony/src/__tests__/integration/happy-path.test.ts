import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockAgent, successfulTurn } from "../mocks/agent.js";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Happy Path", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("processes a Todo issue through a successful agent run", async () => {
    const issue = createMockIssue();
    const agent = createMockAgent([
      () => {
        harness?.tracker.updateIssue(issue.id, { state: "Done" });
        return successfulTurn("changes made");
      },
    ]);
    harness = await createIntegrationHarness({ issues: [issue], agent });

    const result = await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.running.length === 0);

    expect(result).toEqual({ _tag: "Completed", intervalMs: 25 });
    expect(agent.calls).toHaveLength(1);
    expect(harness.tracker.calls.fetchIssueStatesByIds).toEqual([[issue.id]]);
    expect(finalState.retryQueue).toEqual([]);
    expect(finalState.claims).toEqual([]);
    expect(existsSync(harness.workspace.pathFor(issue.identifier))).toBe(true);
    expect(
      existsSync(path.join(harness.workspace.pathFor(issue.identifier), ".mock-agent-turn-1.txt")),
    ).toBe(true);
  });
});
