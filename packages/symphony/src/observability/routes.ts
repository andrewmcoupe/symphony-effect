import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { Effect, Queue } from "effect";
import type {
  DomainEvent,
  OrchestratorRefreshService,
  OrchestratorSnapshot,
  OrchestratorStateRefService,
} from "../orchestrator/index.js";
import type { AgentOutput, IssueDetail, StateSnapshot } from "./types.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

interface RoutesOptions {
  readonly stateRef: OrchestratorStateRefService;
  readonly refresh: OrchestratorRefreshService;
  readonly heartbeatIntervalMs?: number;
}

const toIsoString = (timestamp: number): string => new Date(timestamp).toISOString();

const toAgentOutput = (entry: OrchestratorSnapshot["agentOutputs"][number]): AgentOutput => ({
  issueId: entry.issueId,
  identifier: entry.identifier,
  turnNumber: entry.turnNumber,
  recordedAt: toIsoString(entry.recordedAt),
  output: entry.output,
});

const toStateSnapshot = (snapshot: OrchestratorSnapshot): StateSnapshot => ({
  running: snapshot.running.map((issue) => ({
    issueId: issue.issueId,
    identifier: issue.identifier,
    turnCount: issue.turnCount,
    startedAt: toIsoString(issue.startedAt),
    elapsedMs: issue.elapsedMs,
    state: issue.trackerState ?? "unknown",
    ...(issue.latestAgentOutput === undefined
      ? {}
      : { latestAgentOutput: toAgentOutput(issue.latestAgentOutput) }),
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
  agentOutputs: snapshot.agentOutputs.map(toAgentOutput),
});

const waitForAbort = (stream: SSEStreamingApi): Effect.Effect<void> =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        if (stream.aborted) {
          resolve();
          return;
        }
        stream.onAbort(resolve);
      }),
  );

const writeDomainEvent = (stream: SSEStreamingApi, event: DomainEvent): Effect.Effect<void> =>
  Effect.promise(() =>
    stream.writeSSE({
      event: event._tag,
      data: JSON.stringify({ identifier: event.identifier }),
    }),
  );

const writeHeartbeat = (stream: SSEStreamingApi): Effect.Effect<void> =>
  Effect.promise(() => stream.write(": ping\n\n"));

const streamDomainEvents = ({
  heartbeatIntervalMs,
  stateRef,
  stream,
}: {
  readonly heartbeatIntervalMs: number;
  readonly stateRef: OrchestratorStateRefService;
  readonly stream: SSEStreamingApi;
}): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const subscription = yield* stateRef.subscribe();
      const eventPump = Queue.take(subscription).pipe(
        Effect.flatMap((event) => writeDomainEvent(stream, event)),
        Effect.forever,
      );
      const heartbeat = Effect.sleep(heartbeatIntervalMs).pipe(
        Effect.zipRight(writeHeartbeat(stream)),
        Effect.forever,
      );

      yield* Effect.race(
        waitForAbort(stream),
        Effect.all([eventPump, heartbeat], { concurrency: "unbounded" }),
      );
    }),
  );

type IssueDetailResult =
  | { readonly status: 200; readonly detail: IssueDetail }
  | { readonly status: 404; readonly detail: { readonly message: string } };

const toIssueDetail = (identifier: string, snapshot: OrchestratorSnapshot): IssueDetailResult => {
  const running = snapshot.running.find((issue) => issue.identifier === identifier);
  const agentOutputs = snapshot.agentOutputs
    .filter((entry) => entry.identifier === identifier)
    .map(toAgentOutput);
  if (running !== undefined) {
    return {
      status: 200,
      detail: {
        identifier,
        status: "running",
        ...(running.trackerState === undefined ? {} : { state: running.trackerState }),
        running: {
          turnCount: running.turnCount,
          startedAt: toIsoString(running.startedAt),
          elapsedMs: running.elapsedMs,
        },
        agentOutputs,
      },
    };
  }

  const retry = snapshot.retryQueue.find((entry) => entry.identifier === identifier);
  if (retry !== undefined) {
    return {
      status: 200,
      detail: {
        identifier,
        status: "retrying",
        retry: {
          attempt: retry.attempt,
          dueAt: toIsoString(retry.dueAt),
          error: retry.error,
        },
        agentOutputs,
      },
    };
  }

  const claim = snapshot.claims.find(
    (entry) => "identifier" in entry && entry.identifier === identifier,
  );
  if (claim !== undefined) {
    return {
      status: 200,
      detail: {
        identifier,
        status: "idle",
        ...(claim._tag === "Running" && claim.trackerState !== undefined
          ? { state: claim.trackerState }
          : {}),
        agentOutputs,
      },
    };
  }

  return { status: 404, detail: { message: `Issue ${identifier} was not found` } };
};

export const makeHonoApp = ({
  stateRef,
  refresh,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
}: RoutesOptions): Hono => {
  const app = new Hono();

  app.use("*", cors());

  app.get("/api/v1/events", (context) =>
    streamSSE(context, (stream) =>
      Effect.runPromise(streamDomainEvents({ heartbeatIntervalMs, stateRef, stream })),
    ),
  );

  app.get("/api/v1/state", async (context) => {
    const snapshot = await Effect.runPromise(stateRef.getSnapshot());
    return context.json(toStateSnapshot(snapshot));
  });

  app.get("/api/v1/issues/:identifier", async (context) => {
    const identifier = context.req.param("identifier");
    const snapshot = await Effect.runPromise(stateRef.getSnapshot());
    const result = toIssueDetail(identifier, snapshot);
    if (result.status === 404) {
      return context.json(result.detail, 404);
    }
    return context.json(result.detail, 200);
  });

  app.post("/api/v1/refresh", async (context) => {
    await Effect.runPromise(refresh.requestRefresh());
    return context.json({ refreshRequested: true });
  });

  return app;
};
