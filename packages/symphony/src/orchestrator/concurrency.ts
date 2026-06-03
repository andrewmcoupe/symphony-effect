import { Context, Effect, Layer, Ref, Scope } from "effect";
import type { WorkflowConfig } from "../config/index.js";
import { OrchestratorStateRef } from "./state/index.js";

export interface ConcurrencyCounts {
  readonly global: { readonly used: number; readonly max: number };
  readonly byState: Map<string, { readonly used: number; readonly max: number }>;
}

export type ReleaseSlot = () => Effect.Effect<void>;

export interface ConcurrencyController {
  readonly acquireSlot: () => Effect.Effect<ReleaseSlot, never, Scope.Scope>;
  readonly canDispatch: (state: string) => Effect.Effect<boolean>;
  readonly getCurrentCounts: () => Effect.Effect<ConcurrencyCounts>;
}

export type ConcurrencyControllerConfigValue = WorkflowConfig["agent"];

export const ConcurrencyController = Context.GenericTag<ConcurrencyController>(
  "symphony/ConcurrencyController",
);

export const ConcurrencyControllerConfig = Context.GenericTag<ConcurrencyControllerConfigValue>(
  "symphony/ConcurrencyControllerConfig",
);

const normalizeStateName = (state: string): string => state.trim().toLowerCase();

const normalizeStateLimits = (
  limits: Readonly<Record<string, number>> | undefined,
): Map<string, number> =>
  new Map(Object.entries(limits ?? {}).map(([state, max]) => [normalizeStateName(state), max]));

const incrementStateCount = (counts: Map<string, number>, state: string): void => {
  const normalized = normalizeStateName(state);
  counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
};

export const makeConcurrencyController = ({
  config,
  semaphore,
  usedRef,
  stateRef,
}: {
  readonly config: ConcurrencyControllerConfigValue;
  readonly semaphore: Effect.Semaphore;
  readonly usedRef: Ref.Ref<number>;
  readonly stateRef: OrchestratorStateRef;
}): ConcurrencyController => {
  const stateLimits = normalizeStateLimits(config.max_concurrent_agents_by_state);

  const releaseSlot = (releasedRef: Ref.Ref<boolean>): Effect.Effect<void> =>
    Ref.modify(releasedRef, (released) => {
      const release = released
        ? Effect.void
        : semaphore
            .release(1)
            .pipe(Effect.zipRight(Ref.update(usedRef, (used) => Math.max(0, used - 1))));
      return [release, true] as const;
    }).pipe(Effect.flatten);

  const acquireSlot = (): Effect.Effect<ReleaseSlot, never, Scope.Scope> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const releasedRef = yield* Ref.make(false);
        yield* restore(semaphore.take(1));
        yield* Ref.update(usedRef, (used) => used + 1);

        const release = () => releaseSlot(releasedRef);
        yield* Effect.addFinalizer(release);
        return release;
      }),
    );

  const getCurrentCounts = (): Effect.Effect<ConcurrencyCounts> =>
    Effect.gen(function* () {
      const used = yield* Ref.get(usedRef);
      const state = yield* stateRef.getState();
      const runningByState = new Map<string, number>();

      for (const running of state.running.values()) {
        if (running.trackerState !== undefined)
          incrementStateCount(runningByState, running.trackerState);
      }

      const byState = new Map<string, { readonly used: number; readonly max: number }>();
      for (const [trackerState, max] of stateLimits) {
        byState.set(trackerState, { used: runningByState.get(trackerState) ?? 0, max });
      }

      return {
        global: { used, max: config.max_concurrent_agents },
        byState,
      };
    });

  const canDispatch = (state: string): Effect.Effect<boolean> =>
    getCurrentCounts().pipe(
      Effect.map((counts) => {
        if (counts.global.used >= counts.global.max) return false;

        const stateCount = counts.byState.get(normalizeStateName(state));
        return stateCount === undefined || stateCount.used < stateCount.max;
      }),
    );

  return {
    acquireSlot,
    canDispatch,
    getCurrentCounts,
  };
};

export const ConcurrencyControllerLive: Layer.Layer<
  ConcurrencyController,
  never,
  ConcurrencyControllerConfigValue | OrchestratorStateRef
> = Layer.effect(
  ConcurrencyController,
  Effect.gen(function* () {
    const config = yield* ConcurrencyControllerConfig;
    const stateRef = yield* OrchestratorStateRef;
    const semaphore = yield* Effect.makeSemaphore(config.max_concurrent_agents);
    const usedRef = yield* Ref.make(0);
    return makeConcurrencyController({ config, semaphore, usedRef, stateRef });
  }),
);

export const makeConcurrencyControllerLive = (
  config: ConcurrencyControllerConfigValue,
): Layer.Layer<ConcurrencyController, never, OrchestratorStateRef> =>
  ConcurrencyControllerLive.pipe(Layer.provide(Layer.succeed(ConcurrencyControllerConfig, config)));
