# 019: Graceful Shutdown

## Summary
Implement proper signal handling and graceful shutdown with timeout.

## Dependencies
- 001-project-setup
- 010-orchestrator-state
- 014-worker-execution
- 015-polling-loop
- 018-cli-entry

## Acceptance Criteria

- [x] Signal handlers for SIGINT and SIGTERM
- [x] Shutdown sequence:
  1. Log shutdown initiated
  2. Stop accepting new dispatches (set shutdown flag)
  3. Stop polling loop
  4. Wait for running workers to complete current turn
  5. Timeout after 30 seconds
  6. Force interrupt remaining worker fibers
  7. Run cleanup (workspace hooks if applicable)
  8. Close HTTP server
  9. Exit with code 0
- [x] Shutdown flag checked in dispatch loop
- [x] Fiber interruption for workers
- [x] HTTP server graceful close
- [x] Timeout enforcement (30 seconds default)
- [x] Clean exit logs
- [x] Integration test for shutdown sequence

## Technical Notes

- Use `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)`
- Set shutdown flag in orchestrator state
- Use `Effect.race` with `Effect.sleep(30000)` for timeout
- Use `Fiber.interruptAll` for force kill
- HTTP server: `server.close()` with timeout

## Files to Modify

```
packages/symphony/src/
├── main.ts            # Signal handlers
├── orchestrator/
│   └── orchestrator.ts # Shutdown flag check
└── observability/
    └── server.ts      # Graceful close
```

## Shutdown Flow

```
SIGINT/SIGTERM received
         │
         ▼
   Set shutdown flag
         │
         ▼
   Stop polling loop
         │
         ▼
   ┌─────────────────────────────┐
   │ Wait for workers OR timeout │
   │      (30 seconds max)       │
   └─────────────────────────────┘
         │
         ▼ (timeout or all done)
   Force interrupt remaining fibers
         │
         ▼
   Close HTTP server
         │
         ▼
   Log "Shutdown complete"
         │
         ▼
   process.exit(0)
```

## Shutdown Logging

```
[INFO] Shutdown signal received (SIGINT)
[INFO] Stopping dispatch of new work...
[INFO] Waiting for 3 running workers to complete...
[INFO] Worker ABC-123 completed
[INFO] Worker DEF-456 completed
[WARN] Timeout reached, force stopping 1 remaining worker(s)
[INFO] Closing HTTP server...
[INFO] Shutdown complete
```
