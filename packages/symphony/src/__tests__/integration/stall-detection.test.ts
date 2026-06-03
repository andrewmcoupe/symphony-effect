import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Stall Detection", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("interrupts an unresponsive worker and queues a retry", async () => {
    const startedAt = Date.now();
    let now = startedAt + 10_000;
    const issue = createMockIssue();
    harness = await createIntegrationHarness({
      issues: [issue],
      config: { agent: { max_retry_backoff_ms: 50, stall_timeout_ms: 1 } },
      now: () => now,
    });

    const fiber = Effect.runFork(Effect.never);
    await Effect.runPromise(
      harness.stateRef.markRunning(issue.id, fiber, issue.identifier, issue.state),
    );

    await harness.pollOnce();
    const stalled = await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);

    expect(stalled.running).toEqual([]);
    expect(stalled.retryQueue).toEqual([
      {
        issueId: issue.id,
        identifier: issue.identifier,
        attempt: 1,
        dueAt: now + 50,
        error: "Stalled",
      },
    ]);
  });
});
