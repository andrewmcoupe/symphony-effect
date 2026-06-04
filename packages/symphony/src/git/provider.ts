import { Context, Effect } from "effect";
import type { GitProviderError } from "./errors.js";
import type { OpenPullRequestParams, PullRequestRef } from "./types.js";

export interface GitProvider {
  readonly findOpenPullRequest: (
    headBranch: string,
  ) => Effect.Effect<PullRequestRef | null, GitProviderError>;
  readonly ensurePullRequest: (
    params: OpenPullRequestParams,
  ) => Effect.Effect<PullRequestRef | null, GitProviderError>;
}

export const GitProvider = Context.GenericTag<GitProvider>("symphony/GitProvider");
