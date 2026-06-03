# 026: Integration Testing

## Summary
Set up comprehensive integration tests for the full orchestration flow.

## Dependencies
- All previous tasks (this is the final verification)

## Acceptance Criteria

- [ ] Integration test harness with:
  - Mock Linear API (using msw or similar)
  - Mock Claude Code subprocess
  - Temporary workspace directories
  - Test WORKFLOW.md files
- [ ] **Scenario: Happy Path**
  - Issue in "Todo" state
  - Agent completes successfully
  - Issue transitions tracked
  - Workspace created and populated
- [ ] **Scenario: Retry on Failure**
  - Agent fails on first attempt
  - Retry scheduled with backoff
  - Second attempt succeeds
- [ ] **Scenario: Max Turns Reached**
  - Agent runs to max_turns limit
  - Session ends cleanly
  - Continuation scheduled
- [ ] **Scenario: Stall Detection**
  - Agent becomes unresponsive
  - Stall timeout triggers
  - Worker interrupted, retry scheduled
- [ ] **Scenario: Terminal State Cleanup**
  - Running issue transitions to "Done"
  - Worker stopped
  - Workspace removed
- [ ] **Scenario: Concurrency Limits**
  - Multiple issues dispatched
  - Global limit respected
  - Per-state limits respected
- [ ] **Scenario: Blocker Handling**
  - Issue with non-terminal blocker
  - Not dispatched while blocked
  - Dispatched after blocker resolves
- [ ] **Scenario: Config Reload**
  - WORKFLOW.md changes mid-run
  - New config picked up on next tick
- [ ] Test utilities:
  - `createMockTracker(issues: Issue[])`
  - `createMockAgent(responses: TurnResult[])`
  - `createTempWorkspace()`
  - `waitForState(predicate)`

## Technical Notes

- Use Vitest's test utilities
- msw for HTTP mocking (Linear API)
- Child process mocking for Claude Code
- Temporary directories via `fs.mkdtemp`
- Time manipulation for retry/stall tests

## Files to Create

```
packages/symphony/src/
├── __tests__/
│   ├── integration/
│   │   ├── happy-path.test.ts
│   │   ├── retry.test.ts
│   │   ├── max-turns.test.ts
│   │   ├── stall-detection.test.ts
│   │   ├── terminal-cleanup.test.ts
│   │   ├── concurrency.test.ts
│   │   ├── blockers.test.ts
│   │   └── config-reload.test.ts
│   ├── mocks/
│   │   ├── tracker.ts
│   │   ├── agent.ts
│   │   └── workspace.ts
│   └── utils/
│       ├── setup.ts
│       └── assertions.ts
```

## Example Test

```typescript
import { describe, it, expect } from 'vitest'
import { Effect, Fiber } from 'effect'
import { createMockTracker, createMockAgent, createTestLayers } from '../mocks'

describe('Happy Path', () => {
  it('processes issue from Todo to completion', async () => {
    const tracker = createMockTracker([
      { identifier: 'TEST-1', state: 'Todo', title: 'Test issue' }
    ])

    const agent = createMockAgent([
      { success: true, output: 'Changes made' }
    ])

    const layers = createTestLayers({ tracker, agent })

    const result = await Effect.gen(function* () {
      const orchestrator = yield* Orchestrator

      // Run one tick
      yield* orchestrator.tick()

      // Verify issue was processed
      const state = yield* OrchestratorStateRef
      const snapshot = yield* state.getSnapshot()

      expect(snapshot.running).toHaveLength(1)
      expect(snapshot.running[0].identifier).toBe('TEST-1')
    }).pipe(
      Effect.provide(layers),
      Effect.runPromise
    )
  })
})
```

## Test Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['src/__tests__/mocks/**']
    },
    testTimeout: 30000,  // Integration tests may be slower
  }
})
```
