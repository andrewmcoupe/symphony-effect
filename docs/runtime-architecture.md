# Runtime Architecture

Symphony Effect is a pnpm monorepo with a core orchestrator package and a
dashboard package.

## Packages

- [`packages/symphony`](../packages/symphony): CLI, workflow config, tracker,
  workspace, agent runner, orchestration, HTTP API.
- [`packages/dashboard`](../packages/dashboard): React dashboard that consumes
  the orchestrator HTTP API.

The runtime entry point is [`main.ts`](../packages/symphony/src/main.ts). The
CLI parses a workflow path and optional API port in
[`cli.ts`](../packages/symphony/src/cli.ts).

## Effect Layer Composition

[`layers.ts`](../packages/symphony/src/layers.ts) wires concrete services:

1. Node filesystem and command executor platform layers.
2. Config loader and prompt renderer.
3. In-memory orchestrator state and refresh signal.
4. Linear tracker client.
5. GitHub git provider.
6. Workspace manager and hook executor.
7. Claude Agent SDK runner.
8. Concurrency controller, reconciler, orchestrator, and HTTP server.

The orchestration code depends on service interfaces rather than concrete
implementations. Tests provide mocks for tracker, agent, workspace, git, and
state where possible.

## Startup Flow

[`startSymphony`](../packages/symphony/src/main.ts) performs:

1. Load and validate `WORKFLOW.md`.
2. Log tracker, workspace, concurrency, and polling config.
3. Build the runtime layer from the loaded workflow.
4. Clean terminal issue workspaces.
5. Start the HTTP API if `--port` was supplied.
6. Start the polling loop.
7. On SIGINT/SIGTERM, stop dispatching new work and wait briefly for running
   workers before interrupting them.

## Polling Loop

[`Orchestrator.start`](../packages/symphony/src/orchestrator/orchestrator.ts)
calls `pollOnce` repeatedly. Each tick reloads the workflow, refreshes
reconciliation, drains due retries, fetches active tracker issues, applies
dispatch rules, and starts workers subject to concurrency limits.

The workflow is re-read on every polling tick, so operational changes to
`WORKFLOW.md` can take effect without restarting the process.

