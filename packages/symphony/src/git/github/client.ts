import { Effect, Layer } from "effect";
import {
  type ConfigError,
  ConfigLoader,
  MissingEnvVar as ConfigMissingEnvVar,
  ValidationFailed,
  type WorkflowConfig,
} from "../../config/index.js";
import {
  ApiError,
  MissingRepository,
  MissingToken,
  RequestFailed,
  type GitProviderError,
  UnknownPayload,
  UnsupportedKind,
} from "../errors.js";
import { GitProvider, type GitProvider as GitProviderService } from "../provider.js";
import type { OpenPullRequestParams, PullRequestRef } from "../types.js";
import { mapGitHubPullRequest } from "./mapper.js";

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

interface GitHubClientOptions {
  readonly loadConfig: () => Effect.Effect<WorkflowConfig, GitProviderError>;
  readonly fetch: GitHubFetch;
}

interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly apiBaseUrl: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatUnknownCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const mapConfigError = (error: ConfigError): GitProviderError => {
  if (error instanceof ConfigMissingEnvVar) return new MissingToken();
  if (error instanceof ValidationFailed) return new UnknownPayload({ reason: error.message });
  return new RequestFailed({ endpoint: "WORKFLOW.md", reason: error.message });
};

const parseRepository = (
  repo: string,
): Effect.Effect<{ readonly owner: string; readonly repo: string }, MissingRepository> => {
  const [owner, name, extra] = repo.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    extra !== undefined ||
    owner.trim() === "" ||
    name.trim() === ""
  ) {
    return Effect.fail(new MissingRepository());
  }
  return Effect.succeed({ owner, repo: name });
};

const validateGitHubConfig = (
  config: WorkflowConfig,
): Effect.Effect<GitHubConfig | null, GitProviderError> =>
  Effect.gen(function* () {
    const git = config.git;
    if (git === undefined) return null;

    const kind = (git as { readonly kind?: string }).kind;
    if (kind !== "github") {
      return yield* Effect.fail(new UnsupportedKind({ kind: kind ?? "(missing)" }));
    }
    if (git.token.trim() === "") return yield* Effect.fail(new MissingToken());

    const repository = yield* parseRepository(git.repo);
    return {
      token: git.token,
      owner: repository.owner,
      repo: repository.repo,
      apiBaseUrl: git.api_base_url,
    };
  });

const normalizeApiBaseUrl = (apiBaseUrl: string): string => apiBaseUrl.replace(/\/+$/, "");

const buildUrl = (
  config: GitHubConfig,
  path: string,
  searchParams: Record<string, string> = {},
): string => {
  const url = new URL(`${normalizeApiBaseUrl(config.apiBaseUrl)}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const repositoryPath = (config: GitHubConfig): string =>
  `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls`;

const parseResponseJson = (response: Response): Effect.Effect<unknown, UnknownPayload> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) => new UnknownPayload({ reason: formatUnknownCause(cause) }),
  });

const readGitHubMessage = (payload: unknown, fallback: string): string => {
  if (!isRecord(payload)) return fallback;

  const message = payload["message"];
  if (typeof message === "string" && message.trim() !== "") {
    const errors = payload["errors"];
    if (!Array.isArray(errors) || errors.length === 0) return message;

    const details = errors
      .map((error) => {
        if (!isRecord(error)) return undefined;
        const field = typeof error["field"] === "string" ? error["field"] : undefined;
        const code = typeof error["code"] === "string" ? error["code"] : undefined;
        const errorMessage = typeof error["message"] === "string" ? error["message"] : undefined;
        return [field, code, errorMessage].filter((part) => part !== undefined).join(" ");
      })
      .filter((detail) => detail !== undefined && detail !== "")
      .join("; ");

    return details === "" ? message : `${message}: ${details}`;
  }

  return fallback;
};

const requestJson = (
  fetchImpl: GitHubFetch,
  config: GitHubConfig,
  endpoint: string,
  init: Pick<RequestInit, "method" | "body">,
): Effect.Effect<{ readonly response: Response; readonly payload: unknown }, GitProviderError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetchImpl(endpoint, {
          ...init,
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "symphony",
          },
        }),
      catch: (cause) => new RequestFailed({ endpoint, reason: formatUnknownCause(cause) }),
    });

    const payload = yield* parseResponseJson(response);
    return { response, payload };
  });

const failApiError = (
  endpoint: string,
  response: Response,
  payload: unknown,
): Effect.Effect<never, ApiError> =>
  Effect.fail(
    new ApiError({
      endpoint,
      status: response.status,
      reason: readGitHubMessage(payload, response.statusText || `HTTP ${response.status}`),
    }),
  );

const benignSkip = (reason: string): Effect.Effect<null> =>
  Effect.logInfo(`Skipping pull request creation: ${reason}`).pipe(Effect.as(null));

const hasMessage = (payload: unknown, pattern: RegExp): boolean =>
  pattern.test(readGitHubMessage(payload, ""));

const isNoCommitsResponse = (payload: unknown): boolean =>
  hasMessage(payload, /no commits between/i);

const isMissingHeadBranchResponse = (payload: unknown): boolean =>
  hasMessage(payload, /head/i) &&
  hasMessage(payload, /not found|invalid|sha can't be blank|must be a branch|not a branch/i);

const isPullRequestAlreadyExistsResponse = (payload: unknown): boolean =>
  hasMessage(payload, /pull request already exists|a pull request already exists/i);

const mapPullRequestArray = (
  payload: unknown,
): Effect.Effect<readonly PullRequestRef[], GitProviderError> =>
  Effect.gen(function* () {
    if (!Array.isArray(payload)) {
      return yield* Effect.fail(
        new UnknownPayload({ reason: "pull requests response is not an array" }),
      );
    }

    const pullRequests: PullRequestRef[] = [];
    for (const item of payload) {
      pullRequests.push(yield* mapGitHubPullRequest(item));
    }
    return pullRequests;
  });

export const makeGitHubClient = ({
  loadConfig,
  fetch: fetchImpl,
}: GitHubClientOptions): GitProviderService => {
  const loadGitHubConfig = (): Effect.Effect<GitHubConfig | null, GitProviderError> =>
    Effect.gen(function* () {
      const config = yield* loadConfig();
      return yield* validateGitHubConfig(config);
    });

  const findOpenPullRequest = (
    headBranch: string,
  ): Effect.Effect<PullRequestRef | null, GitProviderError> =>
    Effect.gen(function* () {
      const config = yield* loadGitHubConfig();
      if (config === null) return null;

      const endpoint = buildUrl(config, repositoryPath(config), {
        head: `${config.owner}:${headBranch}`,
        state: "open",
      });
      const { response, payload } = yield* requestJson(fetchImpl, config, endpoint, {
        method: "GET",
      });

      if (!response.ok) return yield* failApiError(endpoint, response, payload);

      const pullRequests = yield* mapPullRequestArray(payload);
      return pullRequests[0] ?? null;
    });

  const ensurePullRequest = (
    params: OpenPullRequestParams,
  ): Effect.Effect<PullRequestRef | null, GitProviderError> =>
    Effect.gen(function* () {
      const existing = yield* findOpenPullRequest(params.headBranch);
      if (existing !== null) return existing;

      const config = yield* loadGitHubConfig();
      if (config === null) return null;

      const endpoint = buildUrl(config, repositoryPath(config));
      const { response, payload } = yield* requestJson(fetchImpl, config, endpoint, {
        method: "POST",
        body: JSON.stringify({
          title: params.title,
          head: params.headBranch,
          base: params.baseBranch,
          body: params.body,
          draft: params.draft,
        }),
      });

      if (response.status === 404) {
        return yield* benignSkip("head branch was not found on the remote");
      }

      if (response.status === 422 && isNoCommitsResponse(payload)) {
        return yield* benignSkip("no commits between base and head");
      }

      if (response.status === 422 && isMissingHeadBranchResponse(payload)) {
        return yield* benignSkip("head branch was not found on the remote");
      }

      if (response.status === 422 && isPullRequestAlreadyExistsResponse(payload)) {
        return yield* findOpenPullRequest(params.headBranch);
      }

      if (!response.ok) return yield* failApiError(endpoint, response, payload);

      return yield* mapGitHubPullRequest(payload);
    });

  return { findOpenPullRequest, ensurePullRequest };
};

export const makeGitHubClientFromConfig = (
  config: WorkflowConfig,
  fetchImpl: GitHubFetch = globalThis.fetch,
): GitProviderService =>
  makeGitHubClient({
    loadConfig: () => Effect.succeed(config),
    fetch: fetchImpl,
  });

export const makeGitProviderLive = (
  workflowPath = "WORKFLOW.md",
): Layer.Layer<GitProviderService, never, ConfigLoader> =>
  Layer.effect(
    GitProvider,
    Effect.gen(function* () {
      const loader = yield* ConfigLoader;
      return makeGitHubClient({
        loadConfig: () =>
          loader.load(workflowPath).pipe(
            Effect.map((nextLoaded) => nextLoaded.config),
            Effect.mapError(mapConfigError),
          ),
        fetch: globalThis.fetch,
      });
    }),
  );

export const GitProviderLive = makeGitProviderLive();
