# 033: Dashboard SSE Client

## Summary
Consume the `/api/v1/events` SSE stream in the dashboard via a single
`EventSource`, invalidating the TanStack Query cache on each event, and reduce
the polling interval to a slow safety net. Delivers near-real-time agent-output
and issue-state updates end to end.

See [ADR 0001](../../docs/adr/0001-sse-domain-event-pubsub.md).

## Dependencies
- 022-dashboard-api-hooks
- 032-sse-events-endpoint

## Acceptance Criteria

- [ ] `useOrchestratorEvents()` hook mounted once at the root (e.g. in
      `__root.tsx`) that:
  - Opens a native `EventSource` to `${VITE_SYMPHONY_API_BASE_URL}/api/v1/events`.
  - On any event (`TurnRecorded` / `IssueStateChanged` / `TokenTotalsChanged`), calls
    `queryClient.invalidateQueries({ queryKey: ["orchestrator"] })` (coarse
    prefix invalidation).
  - On `open` (initial connect **and** reconnect), invalidates the
    `["orchestrator"]` prefix once to resync — no `Last-Event-ID` needed.
  - Closes the `EventSource` on unmount.
- [ ] `useOrchestratorState` and `useIssueDetail` `refetchInterval` changed from
      `5_000` to a slow safety net (`30_000`), with `refetchOnReconnect: true`.
- [ ] No `Last-Event-ID` / replay logic (events are idempotent signals).
- [ ] Relies on `EventSource`'s built-in auto-reconnect; reconnect triggers the
      `open` resync above.
- [ ] Tests: a mocked `EventSource` dispatching an event triggers
      `invalidateQueries` with the `["orchestrator"]` key; `open` triggers the
      resync invalidation; unmount closes the connection.
- [ ] Existing manual refresh button and optimistic mutation continue to work
      unchanged.

## Technical Notes

- Keep TanStack Query as the network-state layer (per `CLAUDE.md`): SSE only
  *invalidates*, it never writes state into the cache. REST projection remains
  the single source of truth.
- `EventSource` is GET-only and needs no headers — no auth in this API, so the
  native API is sufficient (no fetch-stream polyfill).
- The `["orchestrator"]` prefix matches both `orchestratorStateQueryKey` and
  every `issueDetailQueryKey(identifier)`.
- Guard for `EventSource` availability / cleanup to avoid duplicate connections
  under React StrictMode double-mount in dev.

## Files to Create / Modify

```
packages/dashboard/src/
├── hooks/
│   ├── useOrchestratorEvents.ts   # EventSource + invalidation   (new)
│   ├── useOrchestratorState.ts    # refetchInterval -> 30s        (modify)
│   ├── useIssueDetail.ts          # refetchInterval -> 30s        (modify)
│   ├── index.ts                   # export new hook               (modify)
│   └── hooks.test.ts              # SSE hook tests                (modify)
└── routes/__root.tsx              # mount useOrchestratorEvents()  (modify)
```

## Sketch

```typescript
export const useOrchestratorEvents = () => {
  const queryClient = useQueryClient()
  useEffect(() => {
    const url = `${import.meta.env.VITE_SYMPHONY_API_BASE_URL ?? ""}/api/v1/events`
    const source = new EventSource(url)
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ["orchestrator"] })

    source.onopen = invalidate          // resync on (re)connect
    source.onmessage = invalidate       // any event -> refetch
    return () => source.close()
  }, [queryClient])
}
```
