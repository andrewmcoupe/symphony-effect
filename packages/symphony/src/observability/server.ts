import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { Context, Data, Effect, Layer, Option, Scope } from "effect";
import {
  OrchestratorRefresh,
  OrchestratorStateRef,
  type OrchestratorRefreshService,
  type OrchestratorStateRefService,
} from "../orchestrator/index.js";
import { makeHonoApp } from "./routes.js";
import type { HttpServerBinding, HttpServerStartOptions } from "./types.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_CLOSE_TIMEOUT_MS = 30_000;

export class HttpServerError extends Data.TaggedError("HttpServerError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return `HTTP server failed: ${this.reason}`;
  }
}

export interface HttpServer {
  readonly start: (
    options: HttpServerStartOptions,
  ) => Effect.Effect<HttpServerBinding, HttpServerError, Scope.Scope>;
}

export const HttpServer = Context.GenericTag<HttpServer>("symphony/HttpServer");

const closeServer = (server: ServerType): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    server.close(() => resume(Effect.void));
  });

const closeServerGracefully = (server: ServerType): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Closing HTTP server...");
    const closed = yield* closeServer(server).pipe(Effect.timeoutOption(DEFAULT_CLOSE_TIMEOUT_MS));

    if (Option.isSome(closed)) {
      yield* Effect.logInfo("HTTP server closed");
      return;
    }

    yield* Effect.logWarning("HTTP server close timed out");
  });

const listen = ({
  host,
  port,
  refresh,
  stateRef,
}: {
  readonly host: string;
  readonly port: number;
  readonly refresh: OrchestratorRefreshService;
  readonly stateRef: OrchestratorStateRefService;
}): Effect.Effect<
  { readonly binding: HttpServerBinding; readonly server: ServerType },
  HttpServerError
> =>
  Effect.async((resume) => {
    const app = makeHonoApp({ refresh, stateRef });
    const server = createAdaptorServer({ fetch: app.fetch, hostname: host });

    const onError = (error: Error): void => {
      server.off("error", onError);
      resume(Effect.fail(new HttpServerError({ reason: error.message })));
    };

    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;
      resume(Effect.succeed({ server, binding: { host, port: boundPort } }));
    });
  });

export const makeHttpServer = ({
  refresh,
  stateRef,
}: {
  readonly refresh: OrchestratorRefreshService;
  readonly stateRef: OrchestratorStateRefService;
}): HttpServer => ({
  start: ({ port, host = DEFAULT_HOST }) =>
    Effect.acquireRelease(listen({ host, port, refresh, stateRef }), ({ server }) =>
      closeServerGracefully(server),
    ).pipe(Effect.map(({ binding }) => binding)),
});

export const HttpServerLive: Layer.Layer<
  HttpServer,
  never,
  OrchestratorRefreshService | OrchestratorStateRefService
> = Layer.effect(
  HttpServer,
  Effect.gen(function* () {
    const refresh = yield* OrchestratorRefresh;
    const stateRef = yield* OrchestratorStateRef;
    return makeHttpServer({ refresh, stateRef });
  }),
);
