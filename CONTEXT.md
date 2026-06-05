# Context Glossary

The canonical vocabulary for Symphony. Definitions only — no implementation
details. When code or conversation uses one of these words, it means exactly
what is written here.

## Issue

A unit of work the orchestrator can pick up and hand to an agent. Identified
internally by an `issueId` and externally by a human-facing `identifier`.

## Issue State

The orchestrator's view of where an Issue is in its lifecycle. Internally
modelled as a tagged claim state; the dashboard API projects it to a coarser
status.

| Internal claim tag | Dashboard status | Meaning |
|---|---|---|
| `Unclaimed` | (not surfaced) | Known but not picked up. |
| `Claimed` | `idle` | Reserved by the orchestrator, no agent running yet. |
| `Running` | `running` | An agent is actively working the Issue. |
| `RetryQueued` | `retrying` | A turn failed; the Issue waits in the retry queue until `dueAt`. |

"Idle" is a dashboard-only term for a known Issue that is neither running nor
retrying.

## Turn

One completed agent invocation against an Issue. The agent runner surfaces
output **once per Turn, at completion** — there is no intra-Turn (token-level)
output in the domain. A Turn produces an Agent Output and may report token
usage.

## Agent Output

The text result recorded for a single Turn (`turnNumber`, `recordedAt`,
`output`). The most recent one for a running Issue is its "latest agent
output".

## Domain Event

A semantic notification that the orchestrator's observable state changed,
broadcast to interested observers (e.g. the dashboard). Distinct from a raw
state mutation: only changes worth observing are published.

Current Domain Events:

- **TurnRecorded** — a Turn completed and its Agent Output was recorded.
- **IssueStateChanged** — an Issue's lifecycle state changed (claimed, started,
  retry-queued, retry-taken, released, or tracker-state updated).
- **TokenTotalsChanged** — aggregate token/runtime totals changed after a Turn
  reported usage.

Activity touches and poll timestamps are intentionally **not** Domain Events —
they are noise for observers.
