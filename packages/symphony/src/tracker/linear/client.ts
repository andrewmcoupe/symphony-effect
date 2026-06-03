import { Effect, Layer } from "effect";
import {
  type ConfigError,
  ConfigLoader,
  MissingEnvVar as ConfigMissingEnvVar,
  ValidationFailed,
  type WorkflowConfig,
} from "../../config/index.js";
import { TrackerClient, type TrackerClient as TrackerClientService } from "../client.js";
import {
  ApiError,
  MissingApiKey,
  MissingProjectSlug,
  RequestFailed,
  type TrackerError,
  UnknownPayload,
  UnsupportedKind,
} from "../errors.js";
import type { Issue } from "../types.js";
import {
  decodeIssuesConnection,
  decodeIssueStatesConnection,
  mapLinearIssues,
  normalizeStateName,
} from "./mapper.js";
import { ISSUES_BY_STATES_QUERY, ISSUE_STATES_BY_IDS_QUERY } from "./queries.js";

export type LinearFetch = (endpoint: string, init: RequestInit) => Promise<Response>;

interface LinearClientOptions {
  readonly loadConfig: () => Effect.Effect<WorkflowConfig, TrackerError>;
  readonly fetch: LinearFetch;
}

interface GraphqlRequest {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

interface IssuePageResult {
  readonly issues: Issue[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface IssueStatePageResult {
  readonly states: ReadonlyMap<string, string>;
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatUnknownCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const formatGraphqlErrors = (errors: readonly unknown[]): string =>
  errors
    .map((error) => {
      if (isRecord(error) && typeof error["message"] === "string") {
        return error["message"];
      }
      return JSON.stringify(error);
    })
    .join("; ");

const mapConfigError = (error: ConfigError): TrackerError => {
  if (error instanceof ConfigMissingEnvVar) return new MissingApiKey();
  if (error instanceof ValidationFailed) return new UnknownPayload({ reason: error.message });
  return new RequestFailed({ endpoint: "WORKFLOW.md", reason: error.message });
};

const validateLinearConfig = (
  config: WorkflowConfig,
): Effect.Effect<WorkflowConfig["tracker"], TrackerError> => {
  if (config.tracker.kind !== "linear") {
    return Effect.fail(new UnsupportedKind({ kind: config.tracker.kind }));
  }
  if (config.tracker.api_key.trim() === "") return Effect.fail(new MissingApiKey());
  if (config.tracker.project_slug.trim() === "") return Effect.fail(new MissingProjectSlug());
  return Effect.succeed(config.tracker);
};

const readGraphqlData = (
  endpoint: string,
  payload: unknown,
): Effect.Effect<unknown, ApiError | UnknownPayload> => {
  if (!isRecord(payload)) {
    return Effect.fail(new UnknownPayload({ reason: "response body is not an object" }));
  }

  const errors = payload["errors"];
  if (Array.isArray(errors) && errors.length > 0) {
    return Effect.fail(new ApiError({ endpoint, reason: formatGraphqlErrors(errors) }));
  }

  if (!Object.prototype.hasOwnProperty.call(payload, "data")) {
    return Effect.fail(new UnknownPayload({ reason: "missing data field" }));
  }

  return Effect.succeed(payload["data"]);
};

const readGraphqlErrorReason = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) return undefined;

  const errors = payload["errors"];
  if (Array.isArray(errors) && errors.length > 0) return formatGraphqlErrors(errors);

  return undefined;
};

const parseResponseJson = (response: Response): Effect.Effect<unknown, UnknownPayload> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) => new UnknownPayload({ reason: formatUnknownCause(cause) }),
  });

const postGraphql = (
  fetchImpl: LinearFetch,
  endpoint: string,
  apiKey: string,
  request: GraphqlRequest,
): Effect.Effect<unknown, TrackerError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        }),
      catch: (cause) => new RequestFailed({ endpoint, reason: formatUnknownCause(cause) }),
    });

    const payload = yield* parseResponseJson(response);

    if (!response.ok) {
      const graphqlReason = readGraphqlErrorReason(payload);
      return yield* Effect.fail(
        new ApiError({
          endpoint,
          status: response.status,
          reason: graphqlReason ?? response.statusText ?? `HTTP ${response.status}`,
        }),
      );
    }

    return yield* readGraphqlData(endpoint, payload);
  });

const compareCandidates = (left: Issue, right: Issue): number => {
  const leftPriority = left.priority ?? Number.POSITIVE_INFINITY;
  const rightPriority = right.priority ?? Number.POSITIVE_INFINITY;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.createdAt.getTime() - right.createdAt.getTime();
};

export const makeLinearClient = ({
  loadConfig,
  fetch: fetchImpl,
}: LinearClientOptions): TrackerClientService => {
  const fetchIssuesPage = (
    states: readonly string[],
    cursor: string | null,
  ): Effect.Effect<IssuePageResult, TrackerError> =>
    Effect.gen(function* () {
      const config = yield* loadConfig();
      const tracker = yield* validateLinearConfig(config);
      const data = yield* postGraphql(fetchImpl, tracker.endpoint, tracker.api_key, {
        query: ISSUES_BY_STATES_QUERY,
        variables: {
          projectSlug: tracker.project_slug,
          states,
          cursor,
        },
      });
      const connection = yield* decodeIssuesConnection(data);
      const issues = yield* mapLinearIssues(connection);
      return {
        issues,
        hasNextPage: connection.pageInfo.hasNextPage,
        endCursor: connection.pageInfo.endCursor,
      };
    });

  const fetchAllIssuesByStates = (
    states: readonly string[],
  ): Effect.Effect<Issue[], TrackerError> =>
    Effect.gen(function* () {
      if (states.length === 0) return [];

      const issues: Issue[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const page: IssuePageResult = yield* fetchIssuesPage(states, cursor);
        issues.push(...page.issues);
        hasNextPage = page.hasNextPage;
        cursor = page.endCursor;
        if (hasNextPage && cursor === null) {
          return yield* Effect.fail(
            new UnknownPayload({ reason: "pageInfo.hasNextPage was true with null endCursor" }),
          );
        }
      }

      return issues;
    });

  const fetchIssueStatePage = (
    ids: readonly string[],
    cursor: string | null,
  ): Effect.Effect<IssueStatePageResult, TrackerError> =>
    Effect.gen(function* () {
      const config = yield* loadConfig();
      const tracker = yield* validateLinearConfig(config);
      const data = yield* postGraphql(fetchImpl, tracker.endpoint, tracker.api_key, {
        query: ISSUE_STATES_BY_IDS_QUERY,
        variables: { ids, cursor },
      });
      const connection = yield* decodeIssueStatesConnection(data);
      const states = new Map<string, string>();
      for (const node of connection.nodes) {
        states.set(node.id, normalizeStateName(node.state.name));
      }
      return {
        states,
        hasNextPage: connection.pageInfo.hasNextPage,
        endCursor: connection.pageInfo.endCursor,
      };
    });

  return {
    fetchCandidateIssues: () =>
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const issues = yield* fetchAllIssuesByStates(config.tracker.active_states);
        return issues.sort(compareCandidates);
      }),

    fetchIssuesByStates: fetchAllIssuesByStates,

    fetchIssueStatesByIds: (ids) =>
      Effect.gen(function* () {
        const states = new Map<string, string>();
        if (ids.length === 0) return states;

        let cursor: string | null = null;
        let hasNextPage = true;

        while (hasNextPage) {
          const page: IssueStatePageResult = yield* fetchIssueStatePage(ids, cursor);
          for (const [id, state] of page.states) {
            states.set(id, state);
          }
          hasNextPage = page.hasNextPage;
          cursor = page.endCursor;
          if (hasNextPage && cursor === null) {
            return yield* Effect.fail(
              new UnknownPayload({ reason: "pageInfo.hasNextPage was true with null endCursor" }),
            );
          }
        }

        return states;
      }),
  };
};

export const makeLinearClientFromConfig = (
  config: WorkflowConfig,
  fetchImpl: LinearFetch = globalThis.fetch,
): TrackerClientService =>
  makeLinearClient({
    loadConfig: () => Effect.succeed(config),
    fetch: fetchImpl,
  });

export const makeLinearClientLive = (
  workflowPath = "WORKFLOW.md",
): Layer.Layer<TrackerClientService, never, ConfigLoader> =>
  Layer.effect(
    TrackerClient,
    Effect.gen(function* () {
      const loader = yield* ConfigLoader;
      return makeLinearClient({
        loadConfig: () =>
          loader.load(workflowPath).pipe(
            Effect.map((loaded) => loaded.config),
            Effect.mapError(mapConfigError),
          ),
        fetch: globalThis.fetch,
      });
    }),
  );

export const LinearClientLive = makeLinearClientLive();
