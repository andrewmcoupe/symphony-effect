import { afterEach, describe, expect, it } from "vitest";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Config Reload", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("loads workflow changes on the next polling tick", async () => {
    harness = await createIntegrationHarness({
      config: {
        agent: { max_concurrent_agents: 1 },
        polling: { interval_ms: 111 },
      },
    });

    const first = await harness.pollOnce();
    await harness.rewriteWorkflow({
      agent: { max_concurrent_agents: 3 },
      polling: { interval_ms: 222 },
    });
    const second = await harness.pollOnce();
    const snapshot = await harness.readSnapshot();

    expect(first).toEqual({ _tag: "Completed", intervalMs: 111 });
    expect(second).toEqual({ _tag: "Completed", intervalMs: 222 });
    expect(snapshot.runtimeConfig).toEqual({
      pollingIntervalMs: 222,
      maxConcurrentAgents: 3,
    });
  });
});
