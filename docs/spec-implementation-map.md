# Spec Implementation Map

This page maps Symphony-spec concepts to the current implementation. It is the
best entry point when you know the spec term but not the local source file.

## High-Level Mapping

| Spec concept | Local implementation | Notes |
| --- | --- | --- |
| Workflow file | [`ConfigLoader`](../packages/symphony/src/config/loader.ts), [`schema.ts`](../packages/symphony/src/config/schema.ts) | Parses YAML front matter plus Markdown prompt body from `WORKFLOW.md`. |
| Tracker polling | [`Orchestrator.pollOnce`](../packages/symphony/src/orchestrator/orchestrator.ts), [`LinearClient`](../packages/symphony/src/tracker/linear/client.ts) | Linear is the only tracker implementation. |
| Active states | [`tracker.active_states`](../packages/symphony/src/config/schema.ts) | Issues in these states can be dispatched. Keep review states out to stop reruns. |
| Terminal states | [`cleanupTerminalIssueWorkspaces`](../packages/symphony/src/orchestrator/startup.ts) | Terminal issues are cleaned up at startup. |
| Workspace management | [`WorkspaceManager`](../packages/symphony/src/workspace/manager.ts) | One filesystem workspace per issue identifier. |
| Lifecycle hooks | [`HookExecutor`](../packages/symphony/src/workspace/hooks.ts) | Shell scripts from `WORKFLOW.md` run around agent execution. |
| Agent execution | [`AgentRunner`](../packages/symphony/src/agent/runner.ts) | Uses Claude Agent SDK instead of Codex. |
| In-memory state | [`OrchestratorStateRef`](../packages/symphony/src/orchestrator/state/ref.ts) | Tracks running work, retry queue, outputs, token totals, and claims. |
| Concurrency | [`ConcurrencyController`](../packages/symphony/src/orchestrator/concurrency.ts) | Supports global and per-state limits. |
| Retry queue | [`RetryScheduler`](../packages/symphony/src/orchestrator/retry.ts) | Exponential failure backoff plus short "continuation" scheduling. |
| Reconciliation | [`Reconciler`](../packages/symphony/src/orchestrator/reconciliation.ts) | Refreshes tracker state, detects terminal/stalled work, and schedules retries. |
| Observability | [`observability`](../packages/symphony/src/observability) and [`dashboard`](../packages/dashboard/src) | HTTP API plus React dashboard. |

## Deliberate Deviations

The repo is spec-aligned but not a complete production implementation.

- Agent backend: Claude Agent SDK is used instead of Codex.
- Tracker provider: Linear only.
- Git provider: GitHub pull requests only.
- State durability: orchestrator state and retry queue are in memory.
- Multi-project orchestration: one process loads one `WORKFLOW.md`; run one
  process/container per project for now.
- SSH worker extension: not implemented.
- Tracker status writes: expected to happen through agent-accessible Linear MCP
  tooling or external Linear/GitHub automations, rather than a first-class
  tracker mutation API in the orchestrator.

## Behavioral Invariants

- A worker should only start for an issue in an active state.
- One issue should have at most one running worker in this process.
- Workspace lifecycle is driven by issue identifier and terminal states.
- Hook failures before the agent are blocking; `after_run` failures are logged
  and ignored.
- Pull request creation is best-effort and should not crash the orchestrator.
- Human review should move work to done; agents should not close the loop by
  marking reviewed work as complete.

