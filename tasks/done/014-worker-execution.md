# 014: Worker Execution

## Summary
Implement the worker that executes agent turns for a single issue.

## Dependencies
- 001-project-setup
- 002-config-schema
- 003-config-loader
- 006-workspace-manager
- 007-hook-executor
- 008-prompt-renderer
- 009-agent-runner
- 010-orchestrator-state

## Acceptance Criteria

- [x] `Worker` module with `runWorker(issue: Issue, attempt: number | null)` function
- [x] Worker execution flow:
  1. Ensure workspace exists (create if needed)
  2. Run `after_create` hook if newly created (failure is fatal)
  3. Run `before_run` hook (failure aborts attempt)
  4. Enter turn loop:
     - Render prompt with `{ issue, attempt }`
     - Run agent turn via AgentRunner
     - Update activity timestamp in state
     - Increment turn count
     - Check if issue still active (re-fetch state)
     - Check if max_turns reached
     - If still active and turns remaining: continue
     - Else: exit loop
  5. Run `after_run` hook (failure logged, ignored)
  6. Return worker result
- [x] `WorkerResult` type:
  ```typescript
  type WorkerResult =
    | { _tag: "Completed"; turnCount: number }
    | { _tag: "MaxTurnsReached"; turnCount: number }
    | { _tag: "IssueNoLongerActive"; turnCount: number }
    | { _tag: "Failed"; error: WorkerError; turnCount: number }
  ```
- [x] `WorkerError` type:
  - `WorkerError.WorkspaceCreationFailed`
  - `WorkerError.HookFailed`
  - `WorkerError.AgentFailed`
  - `WorkerError.StateCheckFailed`
- [x] Proper fiber cancellation handling (cleanup on interrupt)
- [x] Integration tests with mocked dependencies

## Technical Notes

- Worker runs as a fiber, reference stored in orchestrator state
- Fiber can be interrupted for stall detection or shutdown
- `attempt` is null on first run, incremented on retries
- First turn uses full prompt, continuation turns could include context
- Activity timestamp update allows stall detection
- Max turns: `agent.max_turns` from config

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/             # (from 010)
├── concurrency.ts     # (from 011)
├── retry.ts           # (from 012)
├── dispatch.ts        # (from 013)
├── worker.ts          # Worker execution
├── index.ts           # Export runWorker
└── worker.test.ts     # Worker tests
```

## Worker Flow Diagram

```
ensureWorkspace()
       │
       ▼ (if createdNow)
 after_create hook
       │
       ▼
  before_run hook
       │
       ▼
┌─────────────────┐
│   Turn Loop     │◄──────────┐
│  render prompt  │           │
│  run agent turn │           │
│  update activity│           │
│  check state    │───────────┤
│  check turns    │  (continue)
└────────┬────────┘
         │ (exit)
         ▼
   after_run hook
         │
         ▼
   return result
```
