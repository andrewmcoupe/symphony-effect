# 032: SSE Events Endpoint

## Summary
Add a single global `GET /api/v1/events` Server-Sent Events endpoint to the Hono
app that streams Domain Events from the orchestrator PubSub to connected
dashboards, with a heartbeat and per-connection cleanup.

See [ADR 0001](../../docs/adr/0001-sse-domain-event-pubsub.md).

## Dependencies
- 017-http-api
- 031-domain-event-pubsub

## Acceptance Criteria

- [x] `GET /api/v1/events` registered on the existing Hono app, gated on the
      server only starting with `--port` (same as the other routes).
- [x] Response uses Hono's `streamSSE` with `Content-Type: text/event-stream`.
- [x] On connect, the handler scopes one `PubSub.subscribe` to the orchestrator
      events PubSub; a forked fiber dequeues events and writes one SSE message
      per event:
  - `event:` = the Domain Event `_tag` (`TurnRecorded` / `IssueStateChanged`)
  - `data:`  = JSON `{ identifier }` (thin signal — no state payload)
- [x] Heartbeat: a comment line (`: ping`) written every ~20s to keep the
      connection alive and detect death.
- [x] On client disconnect/abort, the subscription scope is released and the
      forked fiber interrupted — no leaked subscriptions or fibers.
- [x] CORS continues to apply (reuse the existing `app.use("*", cors())`) so
      `EventSource` works from the dashboard origin.
- [x] Integration test: connect, trigger a state mutation, assert the matching
      SSE `event:`/`data:` frame is received; assert heartbeat is emitted; assert
      cleanup on disconnect.

## Technical Notes

- Bridge Effect → Hono: inside `streamSSE(c, async (stream) => { ... })`, run an
  Effect that subscribes to the PubSub and pumps events to `stream.writeSSE`.
  Use `stream.onAbort` (and/or the request abort signal) to interrupt the pump
  and release the scoped subscription.
- The route needs access to the `OrchestratorStateRef` events surface added in
  031 — thread it through `makeHonoApp`'s options alongside `stateRef`/`refresh`.
- Prefer racing the event pump against a heartbeat schedule rather than two
  uncoordinated timers, so both share one teardown path.
- Sliding PubSub means a slow client silently drops oldest events; that is
  acceptable because events are idempotent signals (client resyncs — slice 033).

## Files to Create / Modify

```
packages/symphony/src/observability/
├── routes.ts          # add GET /api/v1/events handler        (modify)
├── server.ts          # pass events surface into makeHonoApp   (modify)
└── server.test.ts     # SSE integration test                   (modify)
```

## Wire Format

```
event: IssueStateChanged
data: {"identifier":"ABC-123"}

event: TurnRecorded
data: {"identifier":"ABC-123"}

: ping
```

## Manual Verification

```bash
curl -N http://localhost:3000/api/v1/events
# then trigger work / POST /api/v1/refresh in another shell and watch frames
```
