import { Context, Effect, Layer } from "effect";

export interface Reconciler {
  readonly reconcile: () => Effect.Effect<void>;
}

export const Reconciler = Context.GenericTag<Reconciler>("symphony/Reconciler");

export const makeReconciler = (): Reconciler => ({
  reconcile: () => Effect.void,
});

export const ReconcilerLive: Layer.Layer<Reconciler> = Layer.succeed(Reconciler, makeReconciler());
