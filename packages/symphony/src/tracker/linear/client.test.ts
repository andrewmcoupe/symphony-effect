import { Effect, Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowConfig } from "../../config/index.js";
import { ApiError, RequestFailed, UnknownPayload } from "../errors.js";
import { makeLinearClientFromConfig, type LinearFetch } from "./client.js";
import type { LinearIssueNodePayload } from "./mapper.js";

const ENDPOINT = "https://linear.example/graphql";

const baseConfig: WorkflowConfig = {
  tracker: {
    kind: "linear",
    endpoint: ENDPOINT,
    api_key: "lin_api_key",
    project_slug: "project-slug",
    active_states: ["Todo", "In Progress"],
    terminal_states: ["Done"],
  },
  polling: { interval_ms: 30_000 },
  workspace: { root: "/tmp/symphony-workspaces" },
  hooks: { timeout_ms: 60_000 },
  agent: {
    max_concurrent_agents: 10,
    max_turns: 20,
    stall_timeout_ms: 300_000,
    max_retry_backoff_ms: 300_000,
  },
};

const linearIssue = (overrides: Partial<LinearIssueNodePayload> = {}): LinearIssueNodePayload => ({
  id: "issue-1",
  identifier: "ABC-1",
  title: "Build the thing",
  description: "Issue description",
  priority: 2,
  state: { name: "Todo" },
  branchName: "andy/abc-1-build-the-thing",
  url: "https://linear.app/acme/issue/ABC-1",
  labels: { nodes: [{ name: "Bug" }, { name: "Backend" }] },
  relations: { nodes: [] },
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-02T10:00:00.000Z",
  ...overrides,
});

const issuesResponse = (
  nodes: LinearIssueNodePayload[],
  pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  },
) => ({
  data: {
    issues: {
      pageInfo,
      nodes,
    },
  },
});

const issueStatesResponse = (
  nodes: Array<{ readonly id: string; readonly state: { readonly name: string } }>,
  pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  },
) => ({
  data: {
    issues: {
      pageInfo,
      nodes,
    },
  },
});

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), init);

interface GraphqlBody {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

const requestBodyAt = (
  fetchMock: ReturnType<typeof vi.fn<LinearFetch>>,
  callIndex: number,
): GraphqlBody => {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) throw new Error(`Missing fetch call ${callIndex}`);
  const body = call[1].body;
  if (typeof body !== "string") throw new Error("Expected string request body");
  return JSON.parse(body) as GraphqlBody;
};

describe("LinearClient", () => {
  it("fetches, normalizes, and sorts candidate issues", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        issuesResponse([
          linearIssue({
            id: "issue-2",
            identifier: "ABC-2",
            priority: 1,
            createdAt: "2026-01-03T10:00:00.000Z",
            state: { name: "In Progress" },
            labels: { nodes: [{ name: "Feature" }] },
          }),
          linearIssue({
            id: "issue-3",
            identifier: "ABC-3",
            priority: 1,
            createdAt: "2026-01-01T09:00:00.000Z",
            branchName: null,
          }),
          linearIssue({
            id: "issue-1",
            identifier: "ABC-1",
            priority: 3,
          }),
        ]),
      ),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const issues = await Effect.runPromise(client.fetchCandidateIssues());

    expect(issues.map((issue) => issue.identifier)).toEqual(["ABC-3", "ABC-2", "ABC-1"]);
    expect(issues[0]?.state).toBe("todo");
    expect(issues[0]?.branchName).toBe("abc-3");
    expect(issues[1]?.labels).toEqual(["feature"]);
    expect(issues[0]?.createdAt).toBeInstanceOf(Date);

    const body = requestBodyAt(fetchMock, 0);
    expect(body.variables).toMatchObject({
      projectSlug: "project-slug",
      states: ["Todo", "In Progress"],
      cursor: null,
    });
  });

  it("paginates issue queries 50 at a time", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          issuesResponse([linearIssue({ id: "issue-1" })], {
            hasNextPage: true,
            endCursor: "cursor-1",
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(issuesResponse([linearIssue({ id: "issue-2" })])));

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const issues = await Effect.runPromise(client.fetchIssuesByStates(["Done"]));

    expect(issues).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodyAt(fetchMock, 0).variables).toMatchObject({
      states: ["Done"],
      cursor: null,
    });
    expect(requestBodyAt(fetchMock, 1).variables).toMatchObject({
      states: ["Done"],
      cursor: "cursor-1",
    });
  });

  it("extracts blockers from Linear blocks relations", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        issuesResponse([
          linearIssue({
            relations: {
              nodes: [
                {
                  type: "blocks",
                  relatedIssue: {
                    id: "blocker-1",
                    identifier: "ABC-9",
                    state: { name: "In Progress" },
                  },
                },
              ],
            },
          }),
        ]),
      ),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const issues = await Effect.runPromise(client.fetchCandidateIssues());

    expect(issues[0]?.blockedBy).toEqual([
      { id: "blocker-1", identifier: "ABC-9", state: "in progress" },
    ]);
  });

  it("ignores non-blocking issue relations", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        issuesResponse([
          linearIssue({
            relations: {
              nodes: [
                {
                  type: "related",
                  relatedIssue: {
                    id: "related-1",
                    identifier: "ABC-7",
                    state: { name: "Todo" },
                  },
                },
              ],
            },
          }),
        ]),
      ),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const issues = await Effect.runPromise(client.fetchCandidateIssues());

    expect(issues[0]?.blockedBy).toEqual([]);
  });

  it("fetches current issue states by id", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        issueStatesResponse([
          { id: "issue-1", state: { name: "Done" } },
          { id: "issue-2", state: { name: "In Progress" } },
        ]),
      ),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const states = await Effect.runPromise(client.fetchIssueStatesByIds(["issue-1", "issue-2"]));

    expect(states).toEqual(
      new Map([
        ["issue-1", "done"],
        ["issue-2", "in progress"],
      ]),
    );
    expect(requestBodyAt(fetchMock, 0).query).toContain("state { name }");
    expect(requestBodyAt(fetchMock, 0).query).toContain("$ids: [ID!]");
    expect(requestBodyAt(fetchMock, 0).variables).toMatchObject({
      ids: ["issue-1", "issue-2"],
      cursor: null,
    });
  });

  it("maps network errors to RequestFailed", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockRejectedValueOnce(new Error("socket closed"));

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(Effect.either(client.fetchCandidateIssues()));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RequestFailed);
      expect(result.left.reason).toContain("socket closed");
    }
  });

  it("maps auth HTTP errors to ApiError", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { errors: [{ message: "Unauthorized" }] },
        { status: 401, statusText: "Unauthorized" },
      ),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(Effect.either(client.fetchCandidateIssues()));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiError);
      expect(result.left.status).toBe(401);
    }
  });

  it("includes GraphQL validation messages from non-2xx responses", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { errors: [{ message: 'Unknown argument "type" on field "Issue.relations".' }] },
        { status: 400, statusText: "Bad Request" },
      ),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(Effect.either(client.fetchCandidateIssues()));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiError);
      expect(result.left.status).toBe(400);
      expect(result.left.reason).toContain("Unknown argument");
    }
  });

  it("maps GraphQL errors to ApiError", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: null, errors: [{ message: "Bad query" }] }),
    );

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(Effect.either(client.fetchCandidateIssues()));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ApiError);
      expect(result.left.reason).toContain("Bad query");
    }
  });

  it("maps unexpected payloads to UnknownPayload", async () => {
    const fetchMock = vi.fn<LinearFetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { issues: { nodes: [] } } }));

    const client = makeLinearClientFromConfig(baseConfig, fetchMock);
    const result = await Effect.runPromise(Effect.either(client.fetchCandidateIssues()));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UnknownPayload);
    }
  });
});
