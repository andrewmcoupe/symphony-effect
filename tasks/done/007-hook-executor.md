# 007: Hook Executor

## Summary
Implement shell hook execution with timeout enforcement for workspace lifecycle hooks.

## Dependencies
- 001-project-setup
- 002-config-schema
- 006-workspace-manager

## Acceptance Criteria

- [x] `HookExecutor` Effect service defined
- [x] `executeHook(hook: string, workspacePath: string, timeout: number)` method:
  - Runs hook script via `sh -lc`
  - Working directory: workspace path
  - Enforces timeout (kills process if exceeded)
  - Returns exit code and output
- [x] Hook types with proper semantics:
  - `after_create`: failure is fatal to workspace creation
  - `before_run`: failure aborts current attempt
  - `after_run`: failure is logged, ignored
  - `before_remove`: failure is logged, ignored
- [x] `HookError` type:
  - `HookError.ExecutionFailed`
  - `HookError.TimedOut`
  - `HookError.NonZeroExit`
- [x] Environment variables passed to hooks:
  - `ISSUE_IDENTIFIER`: the issue identifier
  - `WORKSPACE_PATH`: absolute path to workspace
- [x] `HookExecutorLive` layer using `@effect/platform` Command
- [x] Unit tests:
  - Successful hook execution
  - Timeout enforcement
  - Non-zero exit handling
  - Working directory verification

## Technical Notes

- Use `@effect/platform/Command` for subprocess management
- Use `Effect.timeout` or `Effect.timeoutFail` for timeout
- Capture both stdout and stderr
- Shell: `sh -lc` (login shell for proper PATH)
- Hook scripts come from WORKFLOW.md, treated as trusted

## Files to Create

```
packages/symphony/src/workspace/
├── types.ts           # (from 006)
├── errors.ts          # Add HookError
├── sanitize.ts        # (from 006)
├── manager.ts         # (from 006)
├── hooks.ts           # HookExecutor service
├── index.ts           # Export HookExecutor
└── hooks.test.ts      # Hook tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const hooks = yield* HookExecutor
  const config = yield* ConfigLoader

  // Run before_run hook (failure aborts)
  if (config.hooks.before_run) {
    yield* hooks.executeHook(
      config.hooks.before_run,
      "/path/to/workspace",
      config.hooks.timeout_ms
    )
  }
})
```
