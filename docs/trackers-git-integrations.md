# Trackers, Git, and Integrations

This repo has abstractions for tracker and git providers, with concrete Linear
and GitHub implementations.

## Tracker Abstraction

- Interface: [`tracker/client.ts`](../packages/symphony/src/tracker/client.ts)
- Types: [`tracker/types.ts`](../packages/symphony/src/tracker/types.ts)
- Errors: [`tracker/errors.ts`](../packages/symphony/src/tracker/errors.ts)
- Linear client: [`tracker/linear/client.ts`](../packages/symphony/src/tracker/linear/client.ts)

The tracker client supports:

- fetching candidate issues by configured active states,
- fetching issues by explicit states,
- refreshing states for issue ids.

The Linear mapper normalizes issue data into the local `Issue` shape used by
prompt rendering, dispatch, and dashboard routes.

## Git Provider Abstraction

- Interface: [`git/provider.ts`](../packages/symphony/src/git/provider.ts)
- Types: [`git/types.ts`](../packages/symphony/src/git/types.ts)
- GitHub client: [`git/github/client.ts`](../packages/symphony/src/git/github/client.ts)
- No-op provider: [`git/noop.ts`](../packages/symphony/src/git/noop.ts)

When `git` is absent from the workflow config, PR creation is disabled through
the no-op provider.

The GitHub client:

- finds an existing open PR by head branch,
- creates a PR when one does not exist,
- treats no-commit and missing-head responses as benign skips,
- re-queries when GitHub reports an existing PR.

## Lifecycle Hooks as Integration Surface

Hooks are currently the most flexible integration point. The reference workflow
uses them to:

- clone the target repository,
- install dependencies,
- reset setup noise,
- commit agent changes,
- push the work branch.

Because hooks are shell scripts, they can also call internal CLIs, configure
credentials, or emit external telemetry. They should remain deterministic and
bounded by `hooks.timeout_ms`.

## Linear MCP

The agent can receive Linear tools through `agent.mcp_servers`. That keeps
tracker writes prompt-managed, matching the current Symphony-style handoff:
the agent performs the tracker transition when it has finished implementation
and local verification.

The orchestration layer still reads Linear through the GraphQL client. MCP is
only passed to the agent runner.

## Adding a New Provider

For a new tracker:

1. Implement `TrackerClient`.
2. Map provider issue data to local `Issue`.
3. Add config schema support.
4. Add a layer factory like `makeLinearClientLive`.
5. Extend tests with provider-specific API behavior.

For a new git provider:

1. Implement `GitProvider`.
2. Map provider PR data to `PullRequestRef`.
3. Add config schema support.
4. Add a provider layer in `git/index.ts`.

