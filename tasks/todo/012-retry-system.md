# 012: Retry System

## Summary
Implement exponential backoff retry queue with Effect Schedule.

## Dependencies
- 001-project-setup
- 002-config-schema
- 010-orchestrator-state

## Acceptance Criteria

- [ ] `RetryScheduler` Effect service defined
- [ ] `calculateDelay(attempt: number)` method:
  - Formula: `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`
  - Returns delay in milliseconds
- [ ] `scheduleRetry(issueId, identifier, attempt, error)` method:
  - Calculates delay
  - Adds entry to retry queue in state
  - Entry includes `dueAt` timestamp
- [ ] `getDueRetries()` method:
  - Returns retry entries where `dueAt <= now`
  - Removes returned entries from queue
- [ ] `scheduleContinuation(issueId, identifier)` method:
  - Short delay (1000ms) for normal continuation
  - Used after clean worker exit to re-check issue state
- [ ] Retry entry structure:
  ```typescript
  interface RetryEntry {
    issueId: string
    identifier: string
    attempt: number
    dueAt: number
    error: string
  }
  ```
- [ ] `RetrySchedulerLive` layer depending on config and state
- [ ] Unit tests:
  - Delay calculation (various attempts)
  - Cap at max_retry_backoff_ms
  - Due retry retrieval
  - Continuation scheduling

## Technical Notes

- Use `Effect.Schedule.exponential` for delay calculation reference
- Explicit queue in state for observability (not just timers)
- `dueAt` is absolute timestamp (Date.now() + delay)
- Continuation vs failure retry have different delays:
  - Continuation: 1000ms (quick re-check)
  - Failure: exponential backoff

## Backoff Examples

| Attempt | Delay (ms) | Capped at 300000ms |
|---------|------------|---------------------|
| 1       | 10000      | 10000              |
| 2       | 20000      | 20000              |
| 3       | 40000      | 40000              |
| 4       | 80000      | 80000              |
| 5       | 160000     | 160000             |
| 6       | 320000     | 300000             |

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/             # (from 010)
├── concurrency.ts     # (from 011)
├── retry.ts           # RetryScheduler service
├── index.ts           # Export RetryScheduler
└── retry.test.ts      # Retry tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const retry = yield* RetryScheduler

  // On worker failure
  yield* retry.scheduleRetry("issue-123", "ABC-123", 1, "Agent timed out")

  // On worker success (re-check if still active)
  yield* retry.scheduleContinuation("issue-123", "ABC-123")

  // In polling loop
  const dueRetries = yield* retry.getDueRetries()
  for (const entry of dueRetries) {
    yield* dispatchIssue(entry.issueId, entry.attempt)
  }
})
```
