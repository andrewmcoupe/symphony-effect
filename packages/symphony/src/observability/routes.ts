import { Hono } from "hono";
import { cors } from "hono/cors";
import { Effect } from "effect";
import type {
  OrchestratorRefreshService,
  OrchestratorSnapshot,
  OrchestratorStateRefService,
} from "../orchestrator/index.js";
import type { IssueDetail, StateSnapshot } from "./types.js";

interface RoutesOptions {
  readonly stateRef: OrchestratorStateRefService;
  readonly refresh: OrchestratorRefreshService;
}

const toIsoString = (timestamp: number): string => new Date(timestamp).toISOString();

const toStateSnapshot = (snapshot: OrchestratorSnapshot): StateSnapshot => ({
  running: snapshot.running.map((issue) => ({
    issueId: issue.issueId,
    identifier: issue.identifier,
    turnCount: issue.turnCount,
    startedAt: toIsoString(issue.startedAt),
    elapsedMs: issue.elapsedMs,
    state: issue.trackerState ?? "unknown",
  })),
  retrying: snapshot.retryQueue.map((entry) => ({
    issueId: entry.issueId,
    identifier: entry.identifier,
    attempt: entry.attempt,
    dueAt: toIsoString(entry.dueAt),
    error: entry.error,
  })),
  tokenTotals: { ...snapshot.tokenTotals },
  config: { ...snapshot.runtimeConfig },
  lastPollAt: snapshot.lastPollAt === null ? null : toIsoString(snapshot.lastPollAt),
  shutdownRequested: snapshot.shutdownRequested,
});

const toIssueDetail = (identifier: string, snapshot: OrchestratorSnapshot): IssueDetail => {
  const running = snapshot.running.find((issue) => issue.identifier === identifier);
  if (running !== undefined) {
    return {
      identifier,
      status: "running",
      running: {
        turnCount: running.turnCount,
        startedAt: toIsoString(running.startedAt),
        elapsedMs: running.elapsedMs,
      },
    };
  }

  const retry = snapshot.retryQueue.find((entry) => entry.identifier === identifier);
  if (retry !== undefined) {
    return {
      identifier,
      status: "retrying",
      retry: {
        attempt: retry.attempt,
        dueAt: toIsoString(retry.dueAt),
        error: retry.error,
      },
    };
  }

  return { identifier, status: "idle" };
};

export const makeHonoApp = ({ stateRef, refresh }: RoutesOptions): Hono => {
  const app = new Hono();

  app.use("*", cors());

  app.get("/api/v1/state", async (context) => {
    const snapshot = await Effect.runPromise(stateRef.getSnapshot());
    return context.json(toStateSnapshot(snapshot));
  });

  app.get("/api/v1/issues/:identifier", async (context) => {
    const identifier = context.req.param("identifier");
    const snapshot = await Effect.runPromise(stateRef.getSnapshot());
    return context.json(toIssueDetail(identifier, snapshot));
  });

  app.post("/api/v1/refresh", async (context) => {
    await Effect.runPromise(refresh.requestRefresh());
    return context.json({ refreshRequested: true });
  });

  return app;
};
