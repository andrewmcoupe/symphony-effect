import { Context, Effect } from "effect";
import type { TrackerError } from "./errors.js";
import type { Issue } from "./types.js";

export interface TrackerClient {
  readonly fetchCandidateIssues: () => Effect.Effect<Issue[], TrackerError>;
  readonly fetchIssuesByStates: (states: readonly string[]) => Effect.Effect<Issue[], TrackerError>;
  readonly fetchIssueStatesByIds: (
    ids: readonly string[],
  ) => Effect.Effect<Map<string, string>, TrackerError>;
}

export const TrackerClient = Context.GenericTag<TrackerClient>("symphony/TrackerClient");
