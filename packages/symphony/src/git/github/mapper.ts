import { Effect } from "effect";
import { UnknownPayload } from "../errors.js";
import type { PullRequestRef } from "../types.js";

export interface GitHubPullRequestPayload {
  readonly number: unknown;
  readonly html_url: unknown;
  readonly state: unknown;
  readonly draft: unknown;
  readonly head: unknown;
  readonly merged_at?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readHeadBranch = (payload: GitHubPullRequestPayload): string | null => {
  if (!isRecord(payload.head)) return null;
  const ref = payload.head["ref"];
  return typeof ref === "string" ? ref : null;
};

export const mapGitHubPullRequest = (
  payload: unknown,
): Effect.Effect<PullRequestRef, UnknownPayload> =>
  Effect.gen(function* () {
    if (!isRecord(payload)) {
      return yield* Effect.fail(new UnknownPayload({ reason: "pull request is not an object" }));
    }

    const pr = payload as unknown as GitHubPullRequestPayload;
    const headBranch = readHeadBranch(pr);

    if (!Number.isInteger(pr.number) || (pr.number as number) <= 0) {
      return yield* Effect.fail(new UnknownPayload({ reason: "pull request number is invalid" }));
    }
    if (typeof pr.html_url !== "string" || pr.html_url.trim() === "") {
      return yield* Effect.fail(new UnknownPayload({ reason: "pull request html_url is invalid" }));
    }
    if (pr.state !== "open" && pr.state !== "closed") {
      return yield* Effect.fail(new UnknownPayload({ reason: "pull request state is invalid" }));
    }
    if (typeof pr.draft !== "boolean") {
      return yield* Effect.fail(new UnknownPayload({ reason: "pull request draft is invalid" }));
    }
    if (headBranch === null) {
      return yield* Effect.fail(new UnknownPayload({ reason: "pull request head.ref is invalid" }));
    }

    return {
      number: pr.number as number,
      url: pr.html_url,
      state: pr.merged_at == null ? pr.state : "merged",
      isDraft: pr.draft,
      headBranch,
    };
  });
