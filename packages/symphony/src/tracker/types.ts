import { Schema } from "effect";

export const BlockerRefSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  state: Schema.String,
});

export interface BlockerRef {
  readonly id: string;
  readonly identifier: string;
  readonly state: string;
}

export const IssueSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.String,
  priority: Schema.NullOr(Schema.Number.pipe(Schema.int())),
  state: Schema.String,
  branchName: Schema.String,
  url: Schema.String,
  labels: Schema.Array(Schema.String),
  blockedBy: Schema.Array(BlockerRefSchema),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});

export interface Issue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly priority: number | null;
  readonly state: string;
  readonly branchName: string;
  readonly url: string;
  readonly labels: readonly string[];
  readonly blockedBy: readonly BlockerRef[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
