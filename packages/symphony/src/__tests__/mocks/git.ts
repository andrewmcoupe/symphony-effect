import { Effect } from "effect";
import type { GitProviderService, OpenPullRequestParams, PullRequestRef } from "../../git/index.js";
import type { GitProviderError } from "../../git/index.js";

type EnsureResponse =
  | PullRequestRef
  | null
  | GitProviderError
  | ((params: OpenPullRequestParams) => PullRequestRef | null | GitProviderError);

export interface MockGitProvider extends GitProviderService {
  readonly calls: {
    readonly findOpenPullRequest: string[];
    readonly ensurePullRequest: OpenPullRequestParams[];
  };
  readonly enqueue: (response: EnsureResponse) => void;
  readonly pullRequests: ReadonlyMap<string, PullRequestRef>;
}

const isGitProviderError = (
  value: PullRequestRef | null | GitProviderError,
): value is GitProviderError =>
  value !== null && "_tag" in value && String(value._tag).startsWith("GitProviderError.");

export const createMockPullRequest = (overrides: Partial<PullRequestRef> = {}): PullRequestRef => ({
  number: 1,
  url: "https://github.example/acme/repo/pull/1",
  state: "open",
  isDraft: false,
  headBranch: "symphony/TEST-1",
  ...overrides,
});

export const createMockGitProvider = (
  responses: readonly EnsureResponse[] = [],
): MockGitProvider => {
  const calls = {
    findOpenPullRequest: [] as string[],
    ensurePullRequest: [] as OpenPullRequestParams[],
  };
  const queue = [...responses];
  const pullRequests = new Map<string, PullRequestRef>();

  const resolveResponse = (
    params: OpenPullRequestParams,
  ): PullRequestRef | null | GitProviderError => {
    const response = queue.shift();
    if (typeof response === "function") return response(params);
    if (response !== undefined) return response;

    const existing = pullRequests.get(params.headBranch);
    if (existing !== undefined) return existing;

    const pullRequest = createMockPullRequest({
      number: pullRequests.size + 1,
      url: `https://github.example/acme/repo/pull/${pullRequests.size + 1}`,
      isDraft: params.draft,
      headBranch: params.headBranch,
    });
    pullRequests.set(params.headBranch, pullRequest);
    return pullRequest;
  };

  return {
    calls,
    enqueue: (response) => {
      queue.push(response);
    },
    pullRequests,
    findOpenPullRequest: (headBranch) =>
      Effect.sync(() => {
        calls.findOpenPullRequest.push(headBranch);
        return pullRequests.get(headBranch) ?? null;
      }),
    ensurePullRequest: (params) =>
      Effect.gen(function* () {
        calls.ensurePullRequest.push(params);
        const response = resolveResponse(params);
        if (isGitProviderError(response)) return yield* Effect.fail(response);
        return response;
      }),
  };
};
