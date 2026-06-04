# Worker Lifecycle

A worker is one attempt to make progress on a single issue. The main
implementation is [`worker.ts`](../packages/symphony/src/orchestrator/worker.ts).

## Dispatch to Worker

The orchestrator dispatches an issue when:

- it appears in a configured active state,
- it is not already claimed/running/retrying in local state,
- its blockers allow dispatch,
- concurrency permits another worker.

Dispatch is coordinated in
[`orchestrator.ts`](../packages/symphony/src/orchestrator/orchestrator.ts) and
[`dispatch.ts`](../packages/symphony/src/orchestrator/dispatch.ts).

## Attempt Flow

For each issue attempt, the worker:

1. Ensures the workspace exists.
2. Runs `after_create` if this is a newly-created workspace.
3. Runs `before_run`.
4. Renders the prompt body with the issue and retry attempt.
5. Calls the agent runner.
6. Records agent output and token usage.
7. Refreshes the issue state from the tracker.
8. Returns a result to the orchestrator.
9. Runs `after_run` best-effort.

## Agent Runner

[`agent/runner.ts`](../packages/symphony/src/agent/runner.ts) wraps the Claude
Agent SDK `query()` API. It passes:

- workspace path as `cwd`,
- bypass permission mode,
- configured model,
- configured max turns,
- configured MCP servers and allowed tools,
- resume session id within the same worker attempt.

It extracts success, output, session id, token usage, cache creation tokens, and
cache read tokens from SDK result messages.

## Worker Results

The worker returns one of:

- `Completed`: agent completed a successful turn and the issue is still active.
- `MaxTurnsReached`: local worker turn budget was reached.
- `IssueNoLongerActive`: tracker state moved out of active states.
- `Failed`: workspace, hook, render, or agent failure.

The orchestrator decides whether to open a pull request, queue a continuation,
schedule a retry, or release the issue.

## Pull Request Creation

Pull requests are created by the orchestrator after worker completion through
[`GitProvider.ensurePullRequest`](../packages/symphony/src/git/provider.ts).

Current behavior:

- `Completed` and `MaxTurnsReached`: ensure PR, then queue continuation.
- `IssueNoLongerActive` with at least one turn: ensure PR, then release.
- Git provider errors are logged and swallowed.

This is intentionally best-effort so a GitHub outage does not crash polling.

## Tracker Handoff

The workflow prompt instructs the agent to move the tracker issue to review
using available Linear tooling. The orchestration layer does not currently have
a first-class Linear status mutation API.

The practical setup is:

- give the agent Linear MCP tools via `agent.mcp_servers`, or
- rely on Linear/GitHub automations such as "linked PR opened -> In Review".

