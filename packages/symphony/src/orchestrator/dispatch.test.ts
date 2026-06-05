import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
  ConcurrencyController,
  type ConcurrencyControllerConfigValue,
  makeConcurrencyControllerLive,
} from "./concurrency.js";
import {
  DispatchDecider,
  type DispatchDecider as DispatchDeciderService,
  type DispatchDeciderConfigValue,
  makeDispatchDeciderLive,
} from "./dispatch.js";
import { OrchestratorStateRef, OrchestratorStateRefLive } from "./state/index.js";
import type { WorkerError } from "./state/types.js";
import type { Issue } from "../tracker/index.js";

const dispatchConfig: DispatchDeciderConfigValue = {
  active_states: ["Todo", "In Progress"],
  terminal_states: ["Done", "Cancelled"],
};

const agentConfig: ConcurrencyControllerConfigValue = {
  max_concurrent_agents: 2,
  max_turns: 20,
  provider: "anthropic",
  stall_timeout_ms: 300_000,
  max_retry_backoff_ms: 300_000,
};

const makeIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: "issue-1",
  identifier: "ABC-1",
  title: "Implement feature",
  description: "Build the feature",
  priority: 1,
  state: "Todo",
  branchName: "abc-1",
  url: "https://linear.app/acme/issue/ABC-1",
  labels: [],
  blockedBy: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  ...overrides,
});

const makeFiber = (): Fiber.RuntimeFiber<void, WorkerError> =>
  Effect.runFork(Effect.void) as Fiber.RuntimeFiber<void, WorkerError>;

const runWithDispatch = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    ConcurrencyController | DispatchDeciderService | OrchestratorStateRef
  >,
  concurrencyConfig = agentConfig,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(makeDispatchDeciderLive(dispatchConfig)),
      Effect.provide(makeConcurrencyControllerLive(concurrencyConfig)),
      Effect.provide(OrchestratorStateRefLive),
    ),
  );

describe("DispatchDecider", () => {
  it("allows active, unclaimed issues when concurrency is available", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return yield* dispatch.isEligible(makeIssue({ state: "todo" }));
      }),
    );

    expect(eligible).toBe(true);
  });

  it("rejects issues outside active states", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return yield* dispatch.isEligible(makeIssue({ state: "Backlog" }));
      }),
    );

    expect(eligible).toBe(false);
  });

  it("rejects terminal issues even if configured active by mistake", async () => {
    const eligible = await Effect.runPromise(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return yield* dispatch.isEligible(makeIssue({ state: "Done" }));
      }).pipe(
        Effect.provide(
          makeDispatchDeciderLive({
            active_states: ["Todo", "Done"],
            terminal_states: ["done"],
          }),
        ),
        Effect.provide(makeConcurrencyControllerLive(agentConfig)),
        Effect.provide(OrchestratorStateRefLive),
      ),
    );

    expect(eligible).toBe(false);
  });

  it("rejects already running issues", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        const state = yield* OrchestratorStateRef;

        yield* state.markRunning("issue-1", makeFiber(), "ABC-1", "Todo");
        return yield* dispatch.isEligible(makeIssue());
      }),
    );

    expect(eligible).toBe(false);
  });

  it("rejects already claimed issues", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        const state = yield* OrchestratorStateRef;

        yield* state.claimIssue("issue-1", "ABC-1");
        return yield* dispatch.isEligible(makeIssue());
      }),
    );

    expect(eligible).toBe(false);
  });

  it("rejects issues when global concurrency is unavailable", async () => {
    const eligible = await runWithDispatch(
      Effect.scoped(
        Effect.gen(function* () {
          const dispatch = yield* DispatchDecider;
          const concurrency = yield* ConcurrencyController;

          yield* concurrency.acquireSlot();
          return yield* dispatch.isEligible(makeIssue());
        }),
      ),
      { ...agentConfig, max_concurrent_agents: 1 },
    );

    expect(eligible).toBe(false);
  });

  it("rejects issues when per-state concurrency is unavailable", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        const state = yield* OrchestratorStateRef;

        yield* state.markRunning("issue-2", makeFiber(), "ABC-2", "Todo");
        return yield* dispatch.isEligible(makeIssue({ id: "issue-1", identifier: "ABC-1" }));
      }),
      { ...agentConfig, max_concurrent_agents_by_state: { Todo: 1 } },
    );

    expect(eligible).toBe(false);
  });

  it("rejects todo issues with non-terminal blockers", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return yield* dispatch.isEligible(
          makeIssue({
            blockedBy: [{ id: "blocker-1", identifier: "ABC-9", state: "In Progress" }],
          }),
        );
      }),
    );

    expect(eligible).toBe(false);
  });

  it("allows todo issues when all blockers are terminal", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return yield* dispatch.isEligible(
          makeIssue({
            blockedBy: [{ id: "blocker-1", identifier: "ABC-9", state: "cancelled" }],
          }),
        );
      }),
    );

    expect(eligible).toBe(true);
  });

  it("skips blocker checks for in-progress issues", async () => {
    const eligible = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return yield* dispatch.isEligible(
          makeIssue({
            state: "In Progress",
            blockedBy: [{ id: "blocker-1", identifier: "ABC-9", state: "Todo" }],
          }),
        );
      }),
    );

    expect(eligible).toBe(true);
  });

  it("sorts by priority, age, and original order", async () => {
    const sorted = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        return dispatch.sortCandidates([
          makeIssue({
            id: "issue-1",
            identifier: "ABC-1",
            priority: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
          makeIssue({
            id: "issue-2",
            identifier: "ABC-2",
            priority: 2,
            createdAt: new Date("2026-01-03T00:00:00.000Z"),
          }),
          makeIssue({
            id: "issue-3",
            identifier: "ABC-3",
            priority: 1,
            createdAt: new Date("2026-01-04T00:00:00.000Z"),
          }),
          makeIssue({
            id: "issue-4",
            identifier: "ABC-4",
            priority: 1,
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
          }),
          makeIssue({
            id: "issue-5",
            identifier: "ABC-5",
            priority: 1,
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
          }),
        ]);
      }),
    );

    expect(sorted.map((issue) => issue.identifier)).toEqual([
      "ABC-4",
      "ABC-5",
      "ABC-3",
      "ABC-2",
      "ABC-1",
    ]);
  });

  it("returns eligible issues in dispatch order", async () => {
    const dispatchable = await runWithDispatch(
      Effect.gen(function* () {
        const dispatch = yield* DispatchDecider;
        const state = yield* OrchestratorStateRef;

        yield* state.claimIssue("issue-claimed", "ABC-4");

        return yield* dispatch.getDispatchableIssues([
          makeIssue({
            id: "issue-null",
            identifier: "ABC-1",
            priority: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
          makeIssue({
            id: "issue-blocked",
            identifier: "ABC-2",
            priority: 1,
            blockedBy: [{ id: "blocker-1", identifier: "ABC-9", state: "Todo" }],
          }),
          makeIssue({
            id: "issue-top",
            identifier: "ABC-3",
            priority: 1,
            createdAt: new Date("2026-01-03T00:00:00.000Z"),
          }),
          makeIssue({
            id: "issue-claimed",
            identifier: "ABC-4",
            priority: 0,
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
          }),
        ]);
      }),
    );

    expect(dispatchable.map((issue) => issue.identifier)).toEqual(["ABC-3", "ABC-1"]);
  });
});
