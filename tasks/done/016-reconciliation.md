# 016: Reconciliation

## Summary
Implement stall detection and tracker state refresh for running issues.

## Dependencies
- 001-project-setup
- 002-config-schema
- 005-linear-client
- 006-workspace-manager
- 010-orchestrator-state
- 012-retry-system

## Acceptance Criteria

- [x] `Reconciler` Effect service defined
- [x] `reconcile()` method that runs both parts:
  - Part A: Stall detection
  - Part B: State refresh
- [x] **Stall Detection:**
  - For each running issue: check `lastActivityAt`
  - Calculate elapsed: `now - lastActivityAt`
  - If `elapsed > stall_timeout_ms`:
    - Interrupt worker fiber
    - Schedule retry
    - Log stall event
  - If `stall_timeout_ms <= 0`: skip stall detection
- [x] **State Refresh:**
  - Fetch current states for all running issue IDs
  - For each running issue:
    - If state is terminal: stop worker, remove workspace
    - If state is still active: update cached issue state
    - If state unknown (issue deleted?): stop worker, no cleanup
- [x] State refresh failure: keep workers running, retry next tick
- [x] `ReconcilerLive` layer
- [x] Unit tests:
  - Stall detection triggering
  - Stall detection disabled (timeout <= 0)
  - Terminal state handling
  - Active state update
  - Refresh failure resilience

## Technical Notes

- Stall timeout default: 300000ms (5 minutes)
- `lastActivityAt` updated by worker on each agent turn
- Fiber interruption via `Fiber.interrupt`
- Workspace removal runs `before_remove` hook first
- State refresh uses `tracker.fetchIssueStatesByIds()`

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/             # (existing)
├── concurrency.ts     # (existing)
├── retry.ts           # (existing)
├── dispatch.ts        # (existing)
├── worker.ts          # (existing)
├── reconciliation.ts  # Reconciler service
├── orchestrator.ts    # (existing, uses Reconciler)
├── index.ts           # Export Reconciler
└── reconciliation.test.ts # Tests
```

## Reconciliation Flow

```
For each running issue:
│
├─► Stall Detection
│   │
│   ├─ elapsed = now - lastActivityAt
│   │
│   └─ if elapsed > stall_timeout_ms:
│       ├─ Fiber.interrupt(workerFiber)
│       ├─ scheduleRetry(issue, attempt+1, "Stalled")
│       └─ log("Issue stalled", { issueId, elapsed })
│
└─► State Refresh
    │
    ├─ currentState = fetchIssueStatesByIds([...runningIds])
    │
    └─ for each running issue:
        │
        ├─ if state in terminal_states:
        │   ├─ Fiber.interrupt(workerFiber)
        │   ├─ runHook(before_remove)
        │   ├─ removeWorkspace(identifier)
        │   └─ releaseIssue(issueId)
        │
        ├─ if state still active:
        │   └─ updateCachedState(issueId, newState)
        │
        └─ if state unknown:
            ├─ Fiber.interrupt(workerFiber)
            └─ releaseIssue(issueId)
```
