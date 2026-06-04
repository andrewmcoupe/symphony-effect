import { Effect, Layer } from "effect";
import { GitProvider, type GitProvider as GitProviderService } from "./provider.js";

export const makeNoopGitProvider = (): GitProviderService => ({
  findOpenPullRequest: () => Effect.succeed(null),
  ensurePullRequest: () => Effect.succeed(null),
});

export const NoopGitProviderLive: Layer.Layer<GitProvider> = Layer.succeed(
  GitProvider,
  makeNoopGitProvider(),
);
