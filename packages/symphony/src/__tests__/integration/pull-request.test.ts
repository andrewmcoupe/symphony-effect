import { afterEach, describe, expect, it } from "vitest";
import { RequestFailed } from "../../git/index.js";
import { createMockAgent, successfulTurn } from "../mocks/agent.js";
import { createMockGitProvider } from "../mocks/git.js";
import { createMockIssue } from "../mocks/tracker.js";
import type { IntegrationHarness } from "../utils/setup.js";
import { createIntegrationHarness } from "../utils/setup.js";

describe("Integration: Pull Request on Completion", () => {
  let harness: IntegrationHarness | undefined;

  afterEach(async () => {
    await harness?.cleanup();
    harness = undefined;
  });

  it("opens one pull request and reuses it on a later completion", async () => {
    let now = 1_000;
    const issue = createMockIssue({ title: "Wire PR creation" });
    const agent = createMockAgent([successfulTurn("first"), successfulTurn("second")]);
    const gitProvider = createMockGitProvider();
    harness = await createIntegrationHarness({
      issues: [issue],
      agent,
      gitProvider,
      config: {
        agent: { max_turns: 3 },
        git: {
          branch_template: "work/{{ issue.identifier }}",
          base_branch: "develop",
          draft: true,
          title_template: "Review {{ issue.identifier }}",
          body_template: "Linear: {{ issue.url }}",
        },
      },
      now: () => now,
    });

    await harness.pollOnce();
    const first = await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);

    expect(agent.calls).toHaveLength(1);
    expect(gitProvider.calls.ensurePullRequest).toHaveLength(1);
    expect(gitProvider.calls.ensurePullRequest[0]).toMatchObject({
      issue,
      headBranch: "work/TEST-1",
      baseBranch: "develop",
      title: "Review TEST-1",
      body: "Linear: https://linear.app/acme/issue/TEST-1",
      draft: true,
    });
    expect(gitProvider.pullRequests.size).toBe(1);

    now = first.retryQueue[0]?.dueAt ?? 2_000;
    await harness.pollOnce();
    await harness.waitForState(
      (snapshot) => snapshot.running.length === 0 && snapshot.retryQueue[0]?.dueAt === now + 1_000,
    );

    expect(agent.calls).toHaveLength(2);
    expect(gitProvider.calls.ensurePullRequest).toHaveLength(2);
    expect(gitProvider.pullRequests.size).toBe(1);
  });

  it("continues when the git provider reports that no PR should be opened", async () => {
    const now = 1_000;
    const issue = createMockIssue();
    const gitProvider = createMockGitProvider([null]);
    harness = await createIntegrationHarness({
      issues: [issue],
      gitProvider,
      config: {
        agent: { max_turns: 1 },
        git: {},
      },
      now: () => now,
    });

    await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);

    expect(gitProvider.calls.ensurePullRequest).toHaveLength(1);
    expect(gitProvider.pullRequests.size).toBe(0);
    expect(finalState.retryQueue[0]).toMatchObject({
      issueId: issue.id,
      identifier: issue.identifier,
      attempt: 0,
      dueAt: now + 1_000,
      error: "continuation",
    });
  });

  it("swallows GitProviderError and still schedules continuation", async () => {
    const now = 1_000;
    const issue = createMockIssue();
    const gitProvider = createMockGitProvider([
      new RequestFailed({ endpoint: "https://api.github.example", reason: "network down" }),
    ]);
    harness = await createIntegrationHarness({
      issues: [issue],
      gitProvider,
      config: {
        agent: { max_turns: 1 },
        git: {},
      },
      now: () => now,
    });

    await harness.pollOnce();
    const finalState = await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);

    expect(gitProvider.calls.ensurePullRequest).toHaveLength(1);
    expect(finalState.retryQueue[0]).toMatchObject({
      issueId: issue.id,
      identifier: issue.identifier,
      attempt: 0,
      dueAt: now + 1_000,
      error: "continuation",
    });
  });

  it("does not interact with GitProvider when git config is absent", async () => {
    const issue = createMockIssue();
    const gitProvider = createMockGitProvider();
    harness = await createIntegrationHarness({
      issues: [issue],
      gitProvider,
      config: { agent: { max_turns: 1 } },
    });

    await harness.pollOnce();
    await harness.waitForState((snapshot) => snapshot.retryQueue.length === 1);

    expect(gitProvider.calls.ensurePullRequest).toHaveLength(0);
    expect(gitProvider.pullRequests.size).toBe(0);
  });
});
