import { Effect, Either, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowConfig } from "../../config/index.js";
import { ConfigLoader, type LoadedConfig } from "../../config/index.js";
import {
  ApiError,
  MissingRepository,
  MissingToken,
  RequestFailed,
  UnknownPayload,
} from "../errors.js";
import { GitProvider } from "../provider.js";
import { makeGitHubClientFromConfig, makeGitProviderLive, type GitHubFetch } from "./client.js";

const baseConfig: WorkflowConfig = {
  tracker: {
    kind: "linear",
    endpoint: "https://linear.example/graphql",
    api_key: "lin_api_key",
    project_slug: "project-slug",
    active_states: ["Todo", "In Progress"],
    terminal_states: ["Done"],
  },
  polling: { interval_ms: 30_000 },
  workspace: { root: "/tmp/symphony-workspaces" },
  git: {
    kind: "github",
    token: "github-token",
    repo: "acme/widgets",
    api_base_url: "https://github.example.com/api/v3",
    base_branch: "main",
    branch_template: "symphony/{{ issue.identifier }}",
    draft: false,
    title_template: "{{ issue.identifier }}: {{ issue.title }}",
    body_template: "Automated changes for {{ issue.identifier }}.",
  },
  hooks: { timeout_ms: 60_000 },
  agent: {
    max_concurrent_agents: 10,
    max_turns: 20,
    stall_timeout_ms: 300_000,
    max_retry_backoff_ms: 300_000,
  },
};

const configWithoutGit: WorkflowConfig = {
  ...baseConfig,
  git: undefined,
};

const loadedConfig: LoadedConfig = {
  config: configWithoutGit,
  promptTemplate: "Work on {{ issue.identifier }}",
};

const pullRequestPayload = (overrides: Record<string, unknown> = {}) => ({
  number: 42,
  html_url: "https://github.example.com/acme/widgets/pull/42",
  state: "open",
  draft: false,
  head: { ref: "symphony/ABC-123" },
  merged_at: null,
  ...overrides,
});

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
};

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), init);

const requestBodyAt = (
  fetchMock: ReturnType<typeof vi.fn<GitHubFetch>>,
  callIndex: number,
): Record<string, unknown> => {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) throw new Error(`Missing fetch call ${callIndex}`);
  const body = call[1].body;
  if (typeof body !== "string") throw new Error("Expected string request body");
  return JSON.parse(body) as Record<string, unknown>;
};

describe("GitHubClient", () => {
  it("finds an existing open pull request", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([pullRequestPayload()]));

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const pullRequest = await Effect.runPromise(client.findOpenPullRequest("symphony/ABC-123"));

    expect(pullRequest).toEqual({
      number: 42,
      url: "https://github.example.com/acme/widgets/pull/42",
      state: "open",
      isDraft: false,
      headBranch: "symphony/ABC-123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://github.example.com/api/v3/repos/acme/widgets/pulls?head=acme%3Asymphony%2FABC-123&state=open",
    );
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({
      Authorization: "Bearer github-token",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "symphony",
    });
  });

  it("creates a pull request when none exists", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(pullRequestPayload()));

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const pullRequest = await Effect.runPromise(client.ensurePullRequest(params));

    expect(pullRequest?.number).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://github.example.com/api/v3/repos/acme/widgets/pulls",
    );
    expect(requestBodyAt(fetchMock, 1)).toEqual({
      title: "ABC-123: Add git provider",
      head: "symphony/ABC-123",
      base: "main",
      body: "Automated changes for ABC-123.",
      draft: false,
    });
  });

  it("is idempotent when a pull request already exists", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([pullRequestPayload()]));

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const pullRequest = await Effect.runPromise(client.ensurePullRequest(params));

    expect(pullRequest?.number).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1].method).toBe("GET");
  });

  it("returns null for a no-commits validation response", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "Validation Failed: No commits between main and symphony/ABC-123" },
          { status: 422, statusText: "Unprocessable Entity" },
        ),
      );

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const pullRequest = await Effect.runPromise(client.ensurePullRequest(params));

    expect(pullRequest).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when the head branch is missing on the remote", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(
      jsonResponse(
        {
          message: "Validation Failed",
          errors: [{ field: "head", code: "invalid", message: "Head sha can't be blank" }],
        },
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const pullRequest = await Effect.runPromise(client.ensurePullRequest(params));

    expect(pullRequest).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-queries when GitHub reports that a pull request already exists", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "Validation Failed: A pull request already exists for symphony/ABC-123." },
          { status: 422, statusText: "Unprocessable Entity" },
        ),
      )
      .mockResolvedValueOnce(jsonResponse([pullRequestPayload({ number: 43 })]));

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const pullRequest = await Effect.runPromise(client.ensurePullRequest(params));

    expect(pullRequest?.number).toBe(43);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1].method).toBe("GET");
  });

  it("maps auth failures to ApiError", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Bad credentials" }, { status: 401, statusText: "Unauthorized" }),
    );

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(
      Effect.either(client.findOpenPullRequest("symphony/ABC-123")),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiError);
      expect(result.left.status).toBe(401);
      expect(result.left.reason).toContain("Bad credentials");
    }
  });

  it("maps malformed repositories to MissingRepository", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    const client = makeGitHubClientFromConfig(
      {
        ...baseConfig,
        git: {
          ...baseConfig.git,
          repo: "missing-owner-separator",
        },
      },
      fetchMock,
    );

    const result = await Effect.runPromise(
      Effect.either(client.findOpenPullRequest("symphony/ABC-123")),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(MissingRepository);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps empty tokens to MissingToken", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    const client = makeGitHubClientFromConfig(
      {
        ...baseConfig,
        git: {
          ...baseConfig.git,
          token: " ",
        },
      },
      fetchMock,
    );

    const result = await Effect.runPromise(
      Effect.either(client.findOpenPullRequest("symphony/ABC-123")),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(MissingToken);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps unexpected successful payloads to UnknownPayload", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ not: "an array" }));

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(
      Effect.either(client.findOpenPullRequest("symphony/ABC-123")),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnknownPayload);
    }
  });

  it("maps transport errors to RequestFailed", async () => {
    const fetchMock = vi.fn<GitHubFetch>();
    fetchMock.mockRejectedValueOnce(new Error("socket closed"));

    const client = makeGitHubClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(
      Effect.either(client.findOpenPullRequest("symphony/ABC-123")),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RequestFailed);
      expect(result.left.reason).toContain("socket closed");
    }
  });

  it("provides a no-op provider when git config is absent", async () => {
    const loader = ConfigLoader.of({
      load: () => Effect.succeed(loadedConfig),
    });
    const providerLayer = makeGitProviderLive("WORKFLOW.md").pipe(
      Layer.provide(Layer.succeed(ConfigLoader, loader)),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* GitProvider;
        return yield* provider.ensurePullRequest(params);
      }).pipe(Effect.provide(providerLayer)),
    );

    expect(result).toBeNull();
  });
});
