import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeNoopGitProvider } from "./noop.js";
import type { OpenPullRequestParams } from "./types.js";

const params = {
  issue: {
    id: "issue-id",
    identifier: "ABC-123",
    title: "Add git provider",
    description: "",
    priority: null,
    state: "Todo",
    branchName: "symphony/ABC-123",
    url: "https://linear.app/example/issue/ABC-123",
    labels: [],
    blockedBy: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  headBranch: "symphony/ABC-123",
  baseBranch: "main",
  title: "ABC-123: Add git provider",
  body: "Automated changes for ABC-123.",
  draft: false,
} satisfies OpenPullRequestParams;

describe("makeNoopGitProvider", () => {
  it("returns null for PR lookup and creation", () => {
    const provider = makeNoopGitProvider();

    expect(Effect.runSync(provider.findOpenPullRequest("symphony/ABC-123"))).toBeNull();
    expect(Effect.runSync(provider.ensurePullRequest(params))).toBeNull();
  });
});
