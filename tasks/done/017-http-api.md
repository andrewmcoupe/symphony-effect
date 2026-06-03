# 017: HTTP API (Hono)

## Summary
Implement the observability HTTP API using Hono.

## Dependencies
- 001-project-setup
- 010-orchestrator-state

## Acceptance Criteria

- [x] `HttpServer` Effect service defined
- [x] Hono app with routes:
  - `GET /api/v1/state` - Full orchestrator snapshot
  - `GET /api/v1/issues/:identifier` - Issue-specific details
  - `POST /api/v1/refresh` - Trigger immediate poll
- [x] `GET /api/v1/state` response:
  ```typescript
  interface StateSnapshot {
    running: {
      issueId: string
      identifier: string
      turnCount: number
      startedAt: string      // ISO-8601
      elapsedMs: number
      state: string          // current tracker state
    }[]
    retrying: {
      issueId: string
      identifier: string
      attempt: number
      dueAt: string          // ISO-8601
      error: string
    }[]
    tokenTotals: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      runtimeSeconds: number
    }
    config: {
      pollingIntervalMs: number
      maxConcurrentAgents: number
    }
    lastPollAt: string | null
  }
  ```
- [x] `GET /api/v1/issues/:identifier` response:
  ```typescript
  interface IssueDetail {
    identifier: string
    status: "running" | "retrying" | "idle"
    running?: { turnCount: number; startedAt: string; elapsedMs: number }
    retry?: { attempt: number; dueAt: string; error: string }
  }
  ```
- [x] `POST /api/v1/refresh` triggers immediate poll tick
- [x] CORS headers for dashboard access
- [x] Bind to loopback (127.0.0.1) by default
- [x] Port from CLI `--port` argument
- [x] `HttpServerLive` layer
- [x] Integration tests

## Technical Notes

- Use `@hono/node-server` for Node.js adapter
- Wrap Hono in Effect for error handling
- `POST /refresh` sets a flag that polling loop checks
- No authentication (reference implementation)
- JSON responses with proper Content-Type

## Files to Create

```
packages/symphony/src/observability/
├── types.ts           # Snapshot types
├── server.ts          # HttpServer service
├── routes.ts          # Hono route handlers
├── index.ts           # Public exports
└── server.test.ts     # Integration tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const server = yield* HttpServer

  // Start server (non-blocking)
  yield* server.start({ port: 3000 })

  // Server runs until interrupted
})
```

## API Examples

```bash
# Get full state
curl http://localhost:3000/api/v1/state

# Get specific issue
curl http://localhost:3000/api/v1/issues/ABC-123

# Trigger refresh
curl -X POST http://localhost:3000/api/v1/refresh
```
