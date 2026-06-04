import { Schema } from "effect";
import type { Issue } from "../tracker/index.js";

export const PullRequestRefSchema = Schema.Struct({
  number: Schema.Number.pipe(Schema.int(), Schema.positive()),
  url: Schema.String,
  state: Schema.Literal("open", "closed", "merged"),
  isDraft: Schema.Boolean,
  headBranch: Schema.String,
});

export interface PullRequestRef {
  readonly number: number;
  readonly url: string;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft: boolean;
  readonly headBranch: string;
}

export interface OpenPullRequestParams {
  readonly issue: Issue;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}
