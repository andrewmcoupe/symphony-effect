# State, Retries, and Concurrency

The Symphony spec relies on the orchestrator knowing what it has claimed, what
is running, and what should be retried. This implementation stores that state in
memory.

## State Model

Core types live in
[`orchestrator/state/types.ts`](../packages/symphony/src/orchestrator/state/types.ts).

The state contains:

- running issues and their fibers,
- retry queue entries,
- recent agent outputs,
- token totals,
- runtime config snapshot,
- last poll timestamp,
- shutdown flag,
- issue claim states.

State mutations are centralized in
[`orchestrator/state/mutations.ts`](../packages/symphony/src/orchestrator/state/mutations.ts)
and exposed through
[`OrchestratorStateRef`](../packages/symphony/src/orchestrator/state/ref.ts).

## Claim States

An issue can be:

- `Unclaimed`
- `Claimed`
- `Running`
- `RetryQueued`

Claims prevent duplicate dispatch inside one process. They are not persisted, so
after a process restart Symphony reconstructs operational reality by polling
Linear and inspecting workspaces.

## Retry Scheduler

[`retry.ts`](../packages/symphony/src/orchestrator/retry.ts) has two queue paths:

- failure retries use exponential backoff capped by `agent.max_retry_backoff_ms`,
- continuations use a short fixed delay and the error label `continuation`.

Continuation means "run the worker again soon", not "do a cheap confirmation".
That distinction matters for cost control.

## Reconciliation

[`reconciliation.ts`](../packages/symphony/src/orchestrator/reconciliation.ts)
periodically reconciles state against tracker data.

It:

- refreshes tracker states for running issues,
- releases work that moved out of active states,
- detects stalled workers using `agent.stall_timeout_ms`,
- interrupts stalled fibers,
- schedules retries for stalled work.

## Concurrency

[`concurrency.ts`](../packages/symphony/src/orchestrator/concurrency.ts) enforces:

- global `agent.max_concurrent_agents`,
- optional per-state limits from `agent.max_concurrent_agents_by_state`.

Per-state limits are useful when you want more work in "In Progress" than
"Todo", or when a particular state represents riskier work.

## Operational Implications

- Run one Symphony process per project until state is durable.
- Do not run multiple replicas against the same Linear project unless you add an
  external lease/lock.
- Keep review states out of `active_states` to stop continuation loops.
- Use conservative `max_turns` while validating new workflows.

