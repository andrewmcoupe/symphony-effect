import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { Context, Data, Effect, Layer, Scope } from "effect";
import {
  OrchestratorRefresh,
  OrchestratorStateRef,
  type OrchestratorRefreshService,
  type OrchestratorStateRefService,
} from "../orchestrator/index.js";
import { makeHonoApp } from "./routes.js";
import type { HttpServerBinding, HttpServerStartOptions } from "./types.js";

const DEFAULT_HOST = "127.0.0.1";

export class HttpServerError extends Data.TaggedError("HttpServerError")<{
  readonly reason: string;
}> {}

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
      closeServer(server),
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
