import { Effect } from "effect";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Terminal State Cleanup", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("stops a running issue that moves to Done and removes its workspace", async () => {
    const issue = createMockIssue({ state: "Done" });
    harness = await createIntegrationHarness({ issues: [issue] });
    await Effect.runPromise(harness.workspace.manager.ensureWorkspace(issue.identifier));
    expect(existsSync(harness.workspace.pathFor(issue.identifier))).toBe(true);

    const fiber = Effect.runFork(Effect.never);
    await Effect.runPromise(
      harness.stateRef.markRunning(issue.id, fiber, issue.identifier, "Todo"),
    );

    await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.running.length === 0);

    expect(finalState.retryQueue).toEqual([]);
    expect(finalState.claims).toEqual([]);
    expect(harness.hookCalls).toContain("before_remove");
    expect(existsSync(harness.workspace.pathFor(issue.identifier))).toBe(false);
  });
});
