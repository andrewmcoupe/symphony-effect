import { Context, Deferred, Effect, Layer, Ref } from "effect";

interface RefreshState {
  readonly requested: boolean;
  readonly signal: Deferred.Deferred<void>;
}

export interface OrchestratorRefresh {
  readonly requestRefresh: () => Effect.Effect<void>;
  readonly takeRefreshRequested: () => Effect.Effect<boolean>;
  readonly waitForRefreshOrTimeout: (timeoutMs: number) => Effect.Effect<boolean>;
}

export const OrchestratorRefresh = Context.GenericTag<OrchestratorRefresh>(
  "symphony/OrchestratorRefresh",
);

export const makeOrchestratorRefresh = (stateRef: Ref.Ref<RefreshState>): OrchestratorRefresh => {
  const resetRefreshRequest = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      if (!state.requested) return false;

      const signal = yield* Deferred.make<void>();
      yield* Ref.set(stateRef, { requested: false, signal });
      return true;
    });

  return {
    requestRefresh: () =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!state.requested) {
          yield* Ref.set(stateRef, { ...state, requested: true });
          yield* Deferred.succeed(state.signal, undefined);
        }
      }),
    takeRefreshRequested: resetRefreshRequest,
    waitForRefreshOrTimeout: (timeoutMs) =>
      Effect.gen(function* () {
        const alreadyRequested = yield* resetRefreshRequest();
        if (alreadyRequested) return true;

        const state = yield* Ref.get(stateRef);
        const refreshed = yield* Deferred.await(state.signal).pipe(
          Effect.as(true),
          Effect.race(Effect.sleep(timeoutMs).pipe(Effect.as(false))),
        );

        if (!refreshed) return false;
        yield* resetRefreshRequest();
        return true;
      }),
  };
};

export const OrchestratorRefreshLive: Layer.Layer<OrchestratorRefresh> = Layer.effect(
  OrchestratorRefresh,
  Deferred.make<void>().pipe(
    Effect.flatMap((signal) => Ref.make<RefreshState>({ requested: false, signal })),
    Effect.map(makeOrchestratorRefresh),
  ),
);
