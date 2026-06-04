import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  HttpServer,
  HttpServerLive,
  makeHonoApp,
  OrchestratorRefresh,
  OrchestratorRefreshLive,
  OrchestratorStateRef,
  OrchestratorStateRefLive,
  type HttpServerService,
  type OrchestratorRefreshService,
  type OrchestratorStateRefService,
} from "../index.js";
import type { WorkerError } from "../orchestrator/state/types.js";

const makeFiber = (): Fiber.RuntimeFiber<void, WorkerError> =>
  Effect.runFork(Effect.void) as Fiber.RuntimeFiber<void, WorkerError>;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const startedAt = Date.now();
  const check = async (): Promise<void> => {
    if (predicate()) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await delay(5);
    await check();
  };
  await check();
};

const readUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 1_000,
): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  const startedAt = Date.now();

  const readMore = async (): Promise<string> => {
    if (predicate(text)) return text;

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for SSE frame. Received:\n${text}`);
    }

    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) =>
        setTimeout(() => resolve({ done: false, value: new Uint8Array() }), remainingMs),
      ),
    ]);
    if (result.done) {
      throw new Error(`SSE stream ended before expected frame. Received:\n${text}`);
    }
    if (result.value.length > 0) {
      text += decoder.decode(result.value, { stream: true });
    }
    return readMore();
  };

  return readMore();
};

const runWithServer = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    HttpServerService | OrchestratorRefreshService | OrchestratorStateRefService
  >,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(HttpServerLive),
      Effect.provide(OrchestratorRefreshLive),
      Effect.provide(OrchestratorStateRefLive),
    ),
  );

describe("HttpServer", () => {
  it("streams domain events, heartbeat frames, and releases subscriptions on disconnect", async () => {
    const setup = await runWithServer(
      Effect.gen(function* () {
        const state = yield* OrchestratorStateRef;
        const refresh = yield* OrchestratorRefresh;
        let activeSubscriptions = 0;
        let releasedSubscriptions = 0;
        const instrumentedState: OrchestratorStateRefService = {
          ...state,
          subscribe: () =>
            Effect.acquireRelease(
              state.subscribe().pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    activeSubscriptions += 1;
                  }),
                ),
              ),
              () =>
                Effect.sync(() => {
                  activeSubscriptions -= 1;
                  releasedSubscriptions += 1;
                }),
            ),
        };

        return {
          app: makeHonoApp({
            heartbeatIntervalMs: 10,
            refresh,
            stateRef: instrumentedState,
          }),
          getSubscriptionCounts: () => ({ activeSubscriptions, releasedSubscriptions }),
          state,
        };
      }),
    );

    const response = await setup.app.fetch(
      new Request("http://localhost/api/v1/events", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Expected SSE response body");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await waitFor(() => setup.getSubscriptionCounts().activeSubscriptions === 1);

    await Effect.runPromise(setup.state.markRunning("issue-1", makeFiber(), "ABC-1", "Todo"));
    const eventText = await readUntil(
      reader,
      (text) =>
        text.includes("event: IssueStateChanged") && text.includes('data: {"identifier":"ABC-1"}'),
    );
    expect(eventText).not.toContain("issue-1");

    await readUntil(reader, (text) => text.includes(": ping"));
    await reader.cancel();
    await waitFor(
      () =>
        setup.getSubscriptionCounts().activeSubscriptions === 0 &&
        setup.getSubscriptionCounts().releasedSubscriptions === 1,
    );
  });

  it("serves the orchestrator state snapshot with CORS and JSON content type", async () => {
    const response = await runWithServer(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* HttpServer;
          const state = yield* OrchestratorStateRef;

          yield* state.recordRuntimeConfig({
            pollingIntervalMs: 250,
            maxConcurrentAgents: 2,
          });
          yield* state.markRunning("issue-1", makeFiber(), "ABC-1", "Todo");
          yield* state.recordTurn("issue-1", "In Progress", "Implemented authentication fix.");
          yield* state.markRetryQueued("issue-2", 3, "rate limited", {
            identifier: "ABC-2",
            dueAt: 1_000,
          });
          yield* state.incrementTokens({
            inputTokens: 10,
            outputTokens: 5,
            runtimeSeconds: 7,
          });
          yield* state.recordPoll(2_000);

          const binding = yield* server.start({ port: 0 });
          const result = yield* Effect.promise(() =>
            fetch(`http://${binding.host}:${binding.port}/api/v1/state`, {
              headers: { Origin: "http://localhost:5173" },
            }),
          );
          const body = yield* Effect.promise(() => result.json());

          return {
            body,
            contentType: result.headers.get("content-type"),
            cors: result.headers.get("access-control-allow-origin"),
            status: result.status,
          };
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("application/json");
    expect(response.cors).toBe("*");
    expect(response.body).toMatchObject({
      running: [
        {
          issueId: "issue-1",
          identifier: "ABC-1",
          turnCount: 1,
          state: "In Progress",
          latestAgentOutput: {
            issueId: "issue-1",
            identifier: "ABC-1",
            turnNumber: 1,
            recordedAt: expect.any(String),
            output: "Implemented authentication fix.",
          },
        },
      ],
      agentOutputs: [
        {
          issueId: "issue-1",
          identifier: "ABC-1",
          turnNumber: 1,
          recordedAt: expect.any(String),
          output: "Implemented authentication fix.",
        },
      ],
      retrying: [
        {
          issueId: "issue-2",
          identifier: "ABC-2",
          attempt: 3,
          dueAt: "1970-01-01T00:00:01.000Z",
          error: "rate limited",
        },
      ],
      tokenTotals: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        runtimeSeconds: 7,
      },
      config: {
        pollingIntervalMs: 250,
        maxConcurrentAgents: 2,
      },
      lastPollAt: "1970-01-01T00:00:02.000Z",
      shutdownRequested: false,
    });
    expect(response.body.running[0].startedAt).toEqual(expect.any(String));
    expect(response.body.running[0].elapsedMs).toEqual(expect.any(Number));
  });

  it("closes the listener when its scope is closed", async () => {
    const result = await runWithServer(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* HttpServer;
          const binding = yield* server.start({ port: 0 });
          const response = yield* Effect.promise(() =>
            fetch(`http://${binding.host}:${binding.port}/api/v1/state`),
          );

          return { binding, status: response.status };
        }),
      ),
    );

    expect(result.status).toBe(200);
    await expect(
      fetch(`http://${result.binding.host}:${result.binding.port}/api/v1/state`),
    ).rejects.toThrow();
  });

  it("serves issue details for running, retrying, and idle issues", async () => {
    const response = await runWithServer(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* HttpServer;
          const state = yield* OrchestratorStateRef;

          yield* state.markRunning("issue-1", makeFiber(), "ABC-1", "Todo");
          yield* state.recordTurn("issue-1", "Todo", "Turn one complete.");
          yield* state.markRetryQueued("issue-2", 2, "failed", {
            identifier: "ABC-2",
            dueAt: 1_000,
          });
          yield* state.claimIssue("issue-3", "ABC-3");

          const binding = yield* server.start({ port: 0 });
          const baseUrl = `http://${binding.host}:${binding.port}/api/v1/issues`;
          const [running, retrying, idle, missing] = yield* Effect.promise(() =>
            Promise.all([
              fetch(`${baseUrl}/ABC-1`).then((item) => item.json()),
              fetch(`${baseUrl}/ABC-2`).then((item) => item.json()),
              fetch(`${baseUrl}/ABC-3`).then((item) => item.json()),
              fetch(`${baseUrl}/ABC-4`).then(async (item) => ({
                body: await item.json(),
                status: item.status,
              })),
            ]),
          );

          return { idle, missing, retrying, running };
        }),
      ),
    );

    expect(response.running).toMatchObject({
      identifier: "ABC-1",
      status: "running",
      state: "Todo",
      running: {
        turnCount: 1,
        startedAt: expect.any(String),
        elapsedMs: expect.any(Number),
      },
      agentOutputs: [
        {
          issueId: "issue-1",
          identifier: "ABC-1",
          turnNumber: 1,
          recordedAt: expect.any(String),
          output: "Turn one complete.",
        },
      ],
    });
    expect(response.retrying).toEqual({
      identifier: "ABC-2",
      status: "retrying",
      retry: {
        attempt: 2,
        dueAt: "1970-01-01T00:00:01.000Z",
        error: "failed",
      },
      agentOutputs: [],
    });
    expect(response.idle).toEqual({ identifier: "ABC-3", status: "idle", agentOutputs: [] });
    expect(response.missing).toEqual({
      body: { message: "Issue ABC-4 was not found" },
      status: 404,
    });
  });

  it("sets the refresh flag when POST refresh is called", async () => {
    const refreshRequested = await runWithServer(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* HttpServer;
          const refresh = yield* OrchestratorRefresh;
          const binding = yield* server.start({ port: 0 });

          const result = yield* Effect.promise(() =>
            fetch(`http://${binding.host}:${binding.port}/api/v1/refresh`, {
              method: "POST",
            }),
          );
          const body = yield* Effect.promise(() => result.json());
          const requested = yield* refresh.takeRefreshRequested();

          return { body, requested, status: result.status };
        }),
      ),
    );

    expect(refreshRequested.status).toBe(200);
    expect(refreshRequested.body).toEqual({ refreshRequested: true });
    expect(refreshRequested.requested).toBe(true);
  });
});
