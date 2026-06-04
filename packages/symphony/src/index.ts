export const VERSION = "0.0.0";

export * from "./agent/index.js";
export * from "./cli.js";
export * from "./config/index.js";
export {
  GitProviderLive,
  makeGitHubClient,
  makeGitHubClientFromConfig,
  makeGitProviderLive,
  makeNoopGitProvider,
  NoopGitProviderLive,
} from "./git/index.js";
export {
  GitProvider,
  type GitHubFetch,
  type GitProviderError,
  type GitProviderService,
  type OpenPullRequestParams,
  type PullRequestRef,
  PullRequestRefSchema,
} from "./git/index.js";
export * from "./layers.js";
export * from "./main.js";
export * from "./observability/index.js";
export * from "./orchestrator/index.js";
export * from "./tracker/index.js";
export * from "./workspace/index.js";
