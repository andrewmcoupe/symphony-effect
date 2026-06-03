# 011: Concurrency Control

## Summary
Implement global and per-state concurrency limits using Effect Semaphore and counting.

## Dependencies
- 001-project-setup
- 002-config-schema
- 010-orchestrator-state

## Acceptance Criteria

- [ ] `ConcurrencyController` Effect service defined
- [ ] Global semaphore with `max_concurrent_agents` permits
- [ ] `acquireSlot()` method:
  - Acquires global semaphore permit
  - Returns release function
- [ ] `canDispatch(state: string)` method:
  - Checks global availability
  - Checks per-state limit if configured
  - Returns boolean
- [ ] `getCurrentCounts()` method:
  ```typescript
  interface ConcurrencyCounts {
    global: { used: number; max: number }
    byState: Map<string, { used: number; max: number }>
  }
  ```
- [ ] Per-state counting from running map:
  - Group running issues by current tracker state
  - Compare against `max_concurrent_agents_by_state[state]`
- [ ] `ConcurrencyControllerLive` layer depending on config and state
- [ ] Unit tests:
  - Global limit enforcement
  - Per-state limit enforcement
  - Mixed limits
  - Slot release

## Technical Notes

- Use `Effect.Semaphore` for global limit
- Per-state limits don't use semaphores (counted from running map)
- State names should be normalized for comparison
- Semaphore acquisition should be scoped (auto-release on fiber end)

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/             # (from 010)
├── concurrency.ts     # ConcurrencyController service
├── index.ts           # Export ConcurrencyController
└── concurrency.test.ts # Concurrency tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const concurrency = yield* ConcurrencyController

  // Check before dispatch
  if (yield* concurrency.canDispatch("Todo")) {
    // Acquire slot with scoped release
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* concurrency.acquireSlot()
        // Do work... slot released when scope ends
      })
    )
  }
})
```

## Config Reference

```yaml
agent:
  max_concurrent_agents: 10        # Global limit
  max_concurrent_agents_by_state:
    Todo: 5                        # Per-state override
    "In Progress": 8
```
