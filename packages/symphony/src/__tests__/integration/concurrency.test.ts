import { afterEach, describe, expect, it } from "vitest";
import { createMockAgent, successfulTurn } from "../mocks/agent.js";
import { createMockIssue } from "../mocks/tracker.js";
import { waitForState } from "../utils/assertions.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Concurrency Limits", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("respects global and per-state limits while dispatching multiple issues", async () => {
    const gates: Array<(result: ReturnType<typeof successfulTurn>) => void> = [];
    const agent = createMockAgent([
      () => new Promise((resolve) => gates.push(resolve)),
      () => new Promise((resolve) => gates.push(resolve)),
      () => new Promise((resolve) => gates.push(resolve)),
    ]);
    const todoOne = createMockIssue({ id: "todo-1", identifier: "TEST-1", priority: 0 });
    const inProgress = createMockIssue({
      id: "progress-1",
      identifier: "TEST-2",
      priority: 1,
      state: "In Progress",
    });
    const todoTwo = createMockIssue({ id: "todo-2", identifier: "TEST-3", priority: 2 });
    harness = await createIntegrationHarness({
      issues: [todoOne, inProgress, todoTwo],
      agent,
      config: {
        agent: {
          max_concurrent_agents: 2,
          max_concurrent_agents_by_state: { Todo: 1, "In Progress": 1 },
        },
      },
    });

    const result = await harness.pollOnce();
    expect(result._tag).toBe("Completed");
    const running = await harness.waitForState((snapshot) => snapshot.running.length === 2);
    await waitForState(
      () => Promise.resolve(agent.calls.length),
      (callCount) => callCount === 2,
    );

    expect(agent.calls).toHaveLength(2);
    expect(running.running.map((issue) => issue.identifier).sort()).toEqual(["TEST-1", "TEST-2"]);
    expect(running.running.map((issue) => issue.identifier)).not.toContain("TEST-3");

    harness.tracker.updateIssue(todoOne.id, { state: "Done" });
    harness.tracker.updateIssue(inProgress.id, { state: "Done" });
    gates.splice(0).forEach((release, index) => release(successfulTurn(`done ${index}`)));

    await harness.waitForState((snapshot) => snapshot.running.length === 0);
  });
});
