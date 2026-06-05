# 031: Domain Event PubSub

## Summary
Add a sliding `PubSub<DomainEvent>` co-located with the orchestrator state ref,
publishing semantic Domain Events from the relevant mutation methods. This is
the emission foundation for SSE dashboard updates.

See [ADR 0001](../../docs/adr/0001-sse-domain-event-pubsub.md) and the
[CONTEXT glossary](../../CONTEXT.md) (Domain Event, Turn, Issue State).

## Dependencies
- 010-orchestrator-state

## Acceptance Criteria

- [x] `DomainEvent` type defined as a discriminated union:
  - `{ _tag: "TurnRecorded"; issueId: string; identifier: string }`
  - `{ _tag: "IssueStateChanged"; issueId: string; identifier: string }`
- [x] An Effect `PubSub<DomainEvent>` created with the **sliding** strategy
      (`PubSub.sliding(capacity)`), so publishing never blocks the orchestrator.
- [x] PubSub is co-located with the state ref and exposed via the
      `OrchestratorStateRef` service (e.g. a `subscribe()` /
      `events: PubSub<DomainEvent>` member) without changing existing mutation
      call sites.
- [x] Mutations publish events as a side effect:
  - `recordTurn` → `TurnRecorded`
  - `markRunning`, `markRetryQueued`, `takeDueRetries`, `releaseIssue`,
    `updateTrackerState`, `claimIssue` → `IssueStateChanged`
- [x] Mutations that publish **nothing**: `incrementTokens`, `updateActivity`,
      `recordPoll`.
- [x] `identifier` is resolved at publish time (via `resolveIssueIdentifier`)
      for mutations that only receive an `issueId`.
- [x] `takeDueRetries` publishes one `IssueStateChanged` per issue it removes
      from the retry queue.
- [x] Unit tests: subscribing, asserting each listed mutation publishes the
      expected event tag/identifier, and asserting the silent mutations publish
      nothing.
- [x] Sliding behaviour verified: a non-draining subscriber does not block a
      publisher.

## Technical Notes

- Keep emission centralized in `orchestrator/state/ref.ts` — wrap the existing
  `Ref.update`/`Ref.modify` calls so each method optionally publishes after the
  state transition. No worker/dispatch call sites should change.
- `PubSub.publish` returns an `Effect<boolean>`; sliding never blocks, so it is
  safe to sequence after the mutation.
- Capacity is a small constant (e.g. 64); document the choice inline.
- Events are intentionally thin signals: issue events carry identifiers, and
  token-total events carry aggregate totals for observability (see ADR 0001).

## Files to Create / Modify

```
packages/symphony/src/orchestrator/state/
├── events.ts          # DomainEvent type + PubSub construction  (new)
├── ref.ts             # publish from mutation methods           (modify)
├── index.ts           # export DomainEvent + subscribe surface  (modify)
└── state.test.ts      # event emission tests                    (modify)
```

## Sketch

```typescript
export type DomainEvent =
  | { readonly _tag: "TurnRecorded"; readonly issueId: string; readonly identifier: string }
  | { readonly _tag: "IssueStateChanged"; readonly issueId: string; readonly identifier: string }

// in makeOrchestratorStateRef, alongside the Ref:
recordTurn: (issueId, trackerState, output) =>
  Ref.update(ref, recordTurnMutation(issueId, trackerState, output)).pipe(
    Effect.zipRight(
      Ref.get(ref).pipe(
        Effect.flatMap((state) =>
          events.publish({
            _tag: "TurnRecorded",
            issueId,
            identifier: resolveIssueIdentifier(state, issueId),
          }),
        ),
      ),
    ),
  ),
```
