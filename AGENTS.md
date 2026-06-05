# Symphony — Agent Guide

> This file and `AGENTS.md` are kept **byte-for-byte identical**. `AGENTS.md` is
> the conventional entry point for non-Anthropic AI tools; `CLAUDE.md` is read by
> Claude Code. Edit both together (or edit one and copy it over the other).

## Non-negotiables

- **Tanstack Query** for network requests and network state (dashboard).
- **Effect TS** where it fits best — see the Effect section below.
- **Oxlint** for linting (`pnpm lint`, `pnpm lint:fix`).
- **Oxfmt** for formatting (`pnpm format`, `pnpm format:check`).

## Repo shape

pnpm workspace, Node ≥ 22, ESM (`"type": "module"`). Import sibling files with
explicit `.js` extensions (e.g. `import { TrackerClient } from "./client.js"`).

- `packages/symphony` — the orchestrator CLI/server. Effect-first. Vitest.
- `packages/dashboard` — React 19 + Vite + Tanstack Query/Router. Vitest + jsdom.

Read `CONTEXT.md` for the canonical domain vocabulary (Issue, Turn, Agent
Output, Domain Event, …). Use those words to mean exactly what is written there.

## Test-Driven Development

Apply TDD wherever it fits — especially domain logic, schema/parsing, error
handling, and service behavior. Follow the **vertical-slice tracer-bullet**
discipline:

1. **Plan.** Decide which *behaviors* matter and confirm the public interface.
   Don't try to test everything — prioritise.
2. **One test → RED.** Write a single failing test that describes one behavior
   through the public interface.
3. **Minimal code → GREEN.** Write only enough code to pass that test. No
   speculative features.
4. **Repeat** the RED→GREEN loop for the next behavior.
5. **Refactor** only once GREEN. Extract duplication, deepen interfaces. **Never
   refactor while a test is red.**

Rules that keep tests valuable:

- **Test behavior through public interfaces, not implementation details.** A
  test that breaks under refactoring when behavior hasn't changed is a bad test.
- A good test reads like a specification ("rejects a config with an empty
  `active_states` array"), exercises real code paths, and survives internal
  refactors.
- **Avoid horizontal slicing** — never write all the tests first and implement
  afterward. That verifies imagined behavior, not actual behavior.
- Don't mock internal collaborators or reach past the interface. Prefer real
  implementations; swap a dependency only at a genuine seam (a service `Tag`, an
  injected function like `ClaudeQuery`).

Run tests with `pnpm --filter symphony test` (or `test:watch`). Typecheck with
`pnpm --filter symphony typecheck`.

## Effect TS conventions

This repo uses Effect idiomatically. Match the existing patterns:

- **Errors are tagged.** Define domain errors with `Data.TaggedError("Domain.Name")<{…}>`
  and give them a human-readable `message` getter. Export a union type for the
  module's error surface (e.g. `export type ConfigError = FileNotFound | …`).
  See `packages/symphony/src/config/errors.ts`.
- **Model failures in the error channel, not by throwing.** Reach for typed
  `Effect.Effect<A, E, R>` over exceptions. Keep the `E` channel precise.
- **Services are interfaces behind a `Context.GenericTag`.** Define the interface
  (methods returning `Effect.Effect<…>`), tag it
  (`Context.GenericTag<TrackerClient>("symphony/TrackerClient")`), and provide
  implementations via **Layers** (`src/layers.ts`). Depend on the tag, not a
  concrete class. See `packages/symphony/src/tracker/client.ts`.
- **Schemas with `@effect/schema`** (`Schema`) for parsing/validating external
  input (config files, API payloads). Decode at the boundary; pass typed values
  inward. See `packages/symphony/src/config/schema.ts`.
- **Composition:** prefer `Effect.gen` for sequential logic and pipe combinators
  (`Effect.map`, `flatMap`, `catchTag`, `mapError`) for transformations. Use
  `catchTag`/`catchTags` to handle specific tagged errors.
- **Concurrency & resources:** use Effect primitives (`Fiber`, scopes,
  `acquireRelease`) rather than ad-hoc Promises when within an Effect program.
- **Keep effects pure until run.** Only execute at the edges (`main.ts`). Don't
  sprinkle `runPromise`/`runSync` through library code.

### Testing Effect code

- `@effect/vitest` and `vitest` are available. For synchronous assertions on
  success/failure, the repo uses
  `Effect.runSync(Effect.either(effect))` and asserts on the `Either`
  (see `config/schema.test.ts`). For async, use `Effect.runPromise` /
  `Effect.runPromiseExit`.
- Test against the error channel: assert the specific `_tag` (e.g.
  `MissingEnvVar`, `ValidationFailed`) rather than message strings where
  possible.
- Inject test doubles through the service `Tag` / a provided Layer, or via
  explicit function seams (e.g. the `ClaudeQuery` parameter in
  `agent/runner.ts`) — don't monkey-patch internals.

## Before you finish a change

1. Add/update focused tests for changed behavior (TDD: ideally written first).
2. `pnpm --filter symphony test` (and dashboard tests if touched).
3. `pnpm --filter symphony typecheck`.
4. `pnpm lint` and `pnpm format:check` (or `lint:fix` / `format`).
5. Keep changes scoped; prefer explicit errors over silent fallbacks; don't
   leave debug logging or unrelated refactors.
