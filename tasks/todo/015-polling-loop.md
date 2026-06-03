# 015: Polling Loop

## Summary
Implement the main polling loop that drives the orchestrator.

## Dependencies
- 001-project-setup
- 002-config-schema
- 003-config-loader
- 005-linear-client
- 010-orchestrator-state
- 011-concurrency-control
- 012-retry-system
- 013-dispatch-eligibility
- 014-worker-execution

## Acceptance Criteria

- [ ] `Orchestrator` Effect service defined
- [ ] `start()` method that begins the polling loop
- [ ] Polling tick sequence:
  1. Re-read and validate WORKFLOW.md (reload config)
  2. Run reconciliation (stall detection + state refresh)
  3. Process due retry entries
  4. Fetch candidate issues from tracker
  5. Get dispatchable issues (filtered + sorted)
  6. Dispatch while slots available:
     - Claim issue
     - Fork worker fiber
     - Mark as running
     - Handle worker completion (schedule retry or continuation)
  7. Update lastPollAt timestamp
  8. Sleep for `polling.interval_ms`
  9. Repeat
- [ ] Config validation failure: skip dispatch, keep reconciliation, emit error
- [ ] Tracker fetch failure: skip tick, retry next poll
- [ ] Worker fork and completion handling:
  - On success: schedule continuation retry (1000ms)
  - On failure: schedule backoff retry
  - On max turns: release issue
- [ ] `OrchestratorLive` layer composing all dependencies
- [ ] Integration tests with mocked services

## Technical Notes

- Use `Effect.schedule` with `Schedule.spaced(interval)` for polling
- Worker fibers run concurrently, managed in state
- Config reload happens each tick (no file watcher)
- Reconciliation runs before dispatch to clean up stale state
- Due retries processed before new candidates

## Files to Create

```
packages/symphony/src/orchestrator/
├── state/             # (from 010)
├── concurrency.ts     # (from 011)
├── retry.ts           # (from 012)
├── dispatch.ts        # (from 013)
├── worker.ts          # (from 014)
├── orchestrator.ts    # Main orchestrator service
├── index.ts           # Export Orchestrator
└── orchestrator.test.ts # Integration tests
```

## Polling Loop Pseudocode

```typescript
const pollTick = Effect.gen(function* () {
  // 1. Reload config
  const configResult = yield* loader.load(workflowPath).pipe(Effect.either)
  if (Either.isLeft(configResult)) {
    yield* logConfigError(configResult.left)
    return // Skip dispatch, continue loop
  }
  const { config, promptTemplate } = configResult.right

  // 2. Reconciliation
  yield* reconcile()

  // 3. Process due retries
  const dueRetries = yield* retry.getDueRetries()
  for (const entry of dueRetries) {
    yield* dispatchRetry(entry)
  }

  // 4. Fetch candidates
  const candidates = yield* tracker.fetchCandidateIssues().pipe(
    Effect.catchAll(() => Effect.succeed([]))
  )

  // 5. Filter and sort
  const dispatchable = yield* dispatch.getDispatchableIssues(candidates)

  // 6. Dispatch
  for (const issue of dispatchable) {
    if (!(yield* concurrency.canDispatch(issue.state))) break
    yield* dispatchIssue(issue)
  }

  // 7. Update timestamp
  yield* state.setLastPollAt(Date.now())
})

const loop = pollTick.pipe(
  Effect.schedule(Schedule.spaced(config.polling.interval_ms))
)
```
