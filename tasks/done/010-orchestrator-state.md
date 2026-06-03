# 010: Orchestrator State Machine

## Summary
Define the orchestrator state model using Effect Ref and tagged unions.

## Dependencies
- 001-project-setup
- 004-tracker-abstraction

## Acceptance Criteria

- [x] `IssueClaimState` tagged union:
  ```typescript
  type IssueClaimState =
    | { _tag: "Unclaimed" }
    | { _tag: "Claimed"; claimedAt: number }
    | { _tag: "Running"; fiber: Fiber.RuntimeFiber<void, WorkerError>; startedAt: number; turnCount: number; lastActivityAt: number }
    | { _tag: "RetryQueued"; attempt: number; dueAt: number; error: string }
  ```
- [x] `RetryEntry` type:
  ```typescript
  interface RetryEntry {
    issueId: string
    identifier: string
    attempt: number
    dueAt: number
    error: string
  }
  ```
- [x] `TokenTotals` type:
  ```typescript
  interface TokenTotals {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    runtimeSeconds: number
  }
  ```
- [x] `OrchestratorState` type:
  ```typescript
  interface OrchestratorState {
    running: Map<string, RunningIssue>
    retryQueue: RetryEntry[]
    tokenTotals: TokenTotals
    lastPollAt: number | null
  }
  ```
- [x] `OrchestratorStateRef` service wrapping `Ref<OrchestratorState>`
- [x] State mutation helpers:
  - `claimIssue(issueId)`
  - `markRunning(issueId, fiber)`
  - `markRetryQueued(issueId, attempt, error)`
  - `releaseIssue(issueId)`
  - `updateActivity(issueId)`
  - `incrementTokens(usage)`
- [x] `getSnapshot()` method for observability
- [x] Unit tests for state transitions

## Technical Notes

- Use `Effect.Ref` for atomic state updates
- All mutations go through the state ref (single authority)
- `Fiber.RuntimeFiber` reference allows interruption
- `lastActivityAt` used for stall detection
- State is in-memory only (no persistence per spec)

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/
│   ├── types.ts       # All state types
│   ├── ref.ts         # OrchestratorStateRef service
│   ├── mutations.ts   # State mutation helpers
│   └── index.ts       # Exports
├── index.ts           # Public exports
└── state/state.test.ts # State tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const state = yield* OrchestratorStateRef

  // Claim an issue
  yield* state.claimIssue("issue-123")

  // Mark as running
  yield* state.markRunning("issue-123", workerFiber)

  // Get snapshot for API
  const snapshot = yield* state.getSnapshot()
})
```
