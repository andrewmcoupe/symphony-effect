import { Effect, ParseResult, Schema } from "effect";
import { UnknownPayload } from "../errors.js";
import type { BlockerRef, Issue } from "../types.js";

const LinearStatePayload = Schema.Struct({
  name: Schema.String,
});

const LinearLabelsPayload = Schema.Struct({
  nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const LinearRelationsPayload = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      relatedIssue: Schema.Struct({
        id: Schema.String,
        identifier: Schema.String,
        state: LinearStatePayload,
      }),
    }),
  ),
});

const LinearPageInfoPayload = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

export const LinearIssueNodePayload = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  priority: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  state: LinearStatePayload,
  branchName: Schema.NullOr(Schema.String),
  url: Schema.String,
  labels: LinearLabelsPayload,
  relations: LinearRelationsPayload,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export interface LinearIssueNodePayload {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly priority: number | null;
  readonly state: { readonly name: string };
  readonly branchName: string | null;
  readonly url: string;
  readonly labels: { readonly nodes: readonly { readonly name: string }[] };
  readonly relations: {
    readonly nodes: readonly {
      readonly type: string;
      readonly relatedIssue: {
        readonly id: string;
        readonly identifier: string;
        readonly state: { readonly name: string };
      };
    }[];
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const LinearIssuesConnectionPayload = Schema.Struct({
  pageInfo: LinearPageInfoPayload,
  nodes: Schema.Array(LinearIssueNodePayload),
});

export interface LinearIssuesConnectionPayload {
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
  readonly nodes: readonly LinearIssueNodePayload[];
}

const LinearIssuesDataPayload = Schema.Struct({
  issues: LinearIssuesConnectionPayload,
});

const LinearIssueStateNodePayload = Schema.Struct({
  id: Schema.String,
  state: LinearStatePayload,
});

const LinearIssueStatesDataPayload = Schema.Struct({
  issues: Schema.Struct({
    pageInfo: LinearPageInfoPayload,
    nodes: Schema.Array(LinearIssueStateNodePayload),
  }),
});

export interface LinearIssueStatesConnectionPayload {
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
  readonly nodes: readonly {
    readonly id: string;
    readonly state: { readonly name: string };
  }[];
}

const decodeIssuesData = Schema.decodeUnknown(LinearIssuesDataPayload, { errors: "all" });
const decodeIssueStatesData = Schema.decodeUnknown(LinearIssueStatesDataPayload, { errors: "all" });

const formatParseError = (parseError: ParseResult.ParseError): string =>
  ParseResult.ArrayFormatter.formatErrorSync(parseError)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");

export const decodeIssuesConnection = (
  payload: unknown,
): Effect.Effect<LinearIssuesConnectionPayload, UnknownPayload> =>
  decodeIssuesData(payload).pipe(
    Effect.map((data) => data.issues),
    Effect.mapError((parseError) => new UnknownPayload({ reason: formatParseError(parseError) })),
  );

export const decodeIssueStatesConnection = (
  payload: unknown,
): Effect.Effect<LinearIssueStatesConnectionPayload, UnknownPayload> =>
  decodeIssueStatesData(payload).pipe(
    Effect.map((data) => data.issues),
    Effect.mapError((parseError) => new UnknownPayload({ reason: formatParseError(parseError) })),
  );

export const normalizeStateName = (state: string): string => state.trim().toLowerCase();
const normalizeRelationType = (type: string): string => type.trim().toLowerCase();

const parseIsoDate = (value: string, field: string): Effect.Effect<Date, UnknownPayload> =>
  Effect.sync(() => new Date(value)).pipe(
    Effect.filterOrFail(
      (date) => !Number.isNaN(date.getTime()),
      () => new UnknownPayload({ reason: `${field} is not a valid ISO-8601 timestamp` }),
    ),
  );

const branchNameFromIdentifier = (identifier: string): string => identifier.toLowerCase();

export const mapLinearIssue = (
  node: LinearIssueNodePayload,
): Effect.Effect<Issue, UnknownPayload> =>
  Effect.gen(function* () {
    const createdAt = yield* parseIsoDate(node.createdAt, "createdAt");
    const updatedAt = yield* parseIsoDate(node.updatedAt, "updatedAt");
    const blockedBy: BlockerRef[] = node.relations.nodes
      .filter((relation) => normalizeRelationType(relation.type) === "blocks")
      .map((relation) => ({
        id: relation.relatedIssue.id,
        identifier: relation.relatedIssue.identifier,
        state: normalizeStateName(relation.relatedIssue.state.name),
      }));

    return {
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      description: node.description ?? "",
      priority: node.priority,
      state: normalizeStateName(node.state.name),
      branchName: node.branchName ?? branchNameFromIdentifier(node.identifier),
      url: node.url,
      labels: node.labels.nodes.map((label) => label.name.toLowerCase()),
      blockedBy,
      createdAt,
      updatedAt,
    };
  });

export const mapLinearIssues = (
  connection: LinearIssuesConnectionPayload,
): Effect.Effect<Issue[], UnknownPayload> =>
  Effect.all(connection.nodes.map((node) => mapLinearIssue(node)));
