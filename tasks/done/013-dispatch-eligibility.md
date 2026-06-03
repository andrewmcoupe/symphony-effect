# 013: Dispatch Eligibility & Sorting

## Summary
Implement the dispatch eligibility rules and issue sorting logic.

## Dependencies
- 001-project-setup
- 002-config-schema
- 004-tracker-abstraction
- 010-orchestrator-state
- 011-concurrency-control

## Acceptance Criteria

- [x] `DispatchDecider` Effect service defined
- [x] `isEligible(issue: Issue)` method checks:
  - State is in `active_states`
  - State is NOT in `terminal_states`
  - Issue is not already running (check state map)
  - Issue is not already claimed
  - Global concurrency available
  - Per-state concurrency available (if configured)
  - If state is "Todo": no non-terminal blockers
- [x] `sortCandidates(issues: Issue[])` method:
  - Primary: priority ascending (null sorts last)
  - Secondary: createdAt ascending (oldest first)
  - Stable sort
- [x] `getDispatchableIssues(candidates: Issue[])` method:
  - Filters eligible issues
  - Sorts by priority/age
  - Returns ordered list
- [x] Blocker check logic:
  - Issue has `blockedBy` array
  - Check if any blocker's state is NOT in `terminal_states`
  - Only applies to "Todo" state (not "In Progress")
- [x] `DispatchDeciderLive` layer
- [x] Unit tests:
  - Eligibility: each rule individually
  - Sorting: priority and age combinations
  - Blocker checking

## Technical Notes

- Priority is nullable - null means no priority, sorts after all integers
- "Todo" blocker check prevents starting work that's blocked
- "In Progress" skips blocker check (already started)
- State comparison should be case-insensitive

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/             # (from 010)
├── concurrency.ts     # (from 011)
├── retry.ts           # (from 012)
├── dispatch.ts        # DispatchDecider service
├── index.ts           # Export DispatchDecider
└── dispatch.test.ts   # Dispatch tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const dispatch = yield* DispatchDecider
  const tracker = yield* TrackerClient

  const candidates = yield* tracker.fetchCandidateIssues()
  const dispatchable = yield* dispatch.getDispatchableIssues(candidates)

  for (const issue of dispatchable) {
    if (yield* dispatch.isEligible(issue)) {
      yield* startWorker(issue)
    }
  }
})
```

## Eligibility Decision Tree

```
Is state in active_states?
  No  → Not eligible
  Yes ↓
Is state in terminal_states?
  Yes → Not eligible
  No  ↓
Is issue already running?
  Yes → Not eligible
  No  ↓
Is issue already claimed?
  Yes → Not eligible
  No  ↓
Is global concurrency available?
  No  → Not eligible
  Yes ↓
Is per-state concurrency available?
  No  → Not eligible
  Yes ↓
Is state "Todo" AND has non-terminal blockers?
  Yes → Not eligible
  No  → ELIGIBLE
```
