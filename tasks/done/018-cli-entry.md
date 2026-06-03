# 018: CLI Entry Point

## Summary
Implement the CLI interface using @effect/cli and wire up all services.

## Dependencies
- 001-project-setup
- 003-config-loader
- 015-polling-loop
- 017-http-api

## Acceptance Criteria

- [x] CLI using `@effect/cli`:
  - Positional argument: workflow path (default: `./WORKFLOW.md`)
  - Option: `--port` (enables HTTP server on specified port)
  - Option: `--help` (auto-generated)
  - Option: `--version`
- [x] Startup sequence:
  1. Parse CLI arguments
  2. Configure Effect logging (JSON for production)
  3. Load and validate WORKFLOW.md (fail fast)
  4. Build service layers
  5. Query terminal issues, clean stale workspaces
  6. Start HTTP server if `--port` specified
  7. Start orchestrator polling loop
  8. Enter Effect runtime
- [x] Exit codes:
  - 0: Clean shutdown
  - 1: Startup failure (invalid config, missing deps)
- [x] Signal handling (SIGINT, SIGTERM):
  - Stop accepting new dispatches
  - Allow running workers to complete (up to 30s)
  - Force kill remaining
  - Clean exit
- [x] Startup validation errors logged clearly
- [x] `main.ts` entry point
- [x] Integration test for startup sequence

## Technical Notes

- Use `@effect/cli` Command and Options
- Layer composition at startup
- Use `Effect.addFinalizer` for cleanup on shutdown
- Use `Effect.runtime` to run the program
- Graceful shutdown via fiber interruption

## Files to Create

```
packages/symphony/src/
├── main.ts            # CLI entry point
├── cli.ts             # CLI command definition
├── layers.ts          # Layer composition
└── index.ts           # Re-export main
```

## CLI Usage

```bash
# Default workflow path
symphony

# Explicit path
symphony ./WORKFLOW.md

# With HTTP server
symphony ./WORKFLOW.md --port 3000

# Help
symphony --help
```

## Layer Composition

```typescript
const MainLive = Layer.mergeAll(
  ConfigLoaderLive,
  TrackerClientLive,
  WorkspaceManagerLive,
  HookExecutorLive,
  PromptRendererLive,
  AgentRunnerLive,
  OrchestratorStateLive,
  ConcurrencyControllerLive,
  RetrySchedulerLive,
  DispatchDeciderLive,
  ReconcilerLive,
  OrchestratorLive,
  HttpServerLive
).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodeRuntime.layer)
)
```

## Startup Logging

```
[INFO] Symphony starting...
[INFO] Loading workflow from ./WORKFLOW.md
[INFO] Tracker: Linear (project: my-project)
[INFO] Workspace root: /home/user/symphony-workspaces
[INFO] Max concurrent agents: 10
[INFO] Polling interval: 30000ms
[INFO] HTTP server listening on http://127.0.0.1:3000
[INFO] Starting polling loop...
```
