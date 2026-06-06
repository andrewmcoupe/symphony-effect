# Context Glossary

The canonical vocabulary for Symphony. Definitions only — no implementation
details. When code or conversation uses one of these words, it means exactly
what is written here.

## Issue

A unit of work the orchestrator can pick up and hand to an agent. Identified
internally by an `issueId` and externally by a human-facing `identifier`.

## Filed Suggestion

An Issue created by an agent during a Turn to record an out-of-scope observation
it made while working a *different* Issue. It is inert on creation — parked for
human triage, never auto-picked-up by the orchestrator — and carries provenance
back to the Turn's originating Issue. Distinct from a human-authored Issue only
by origin and intent.

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

## Provider

The AI vendor whose agent SDK executes a Turn. Symphony supports **Anthropic**
and **OpenAI**. A workflow selects one Provider; the orchestrator and its
observable state are otherwise Provider-agnostic — nothing downstream of the
agent runner knows which Provider ran a Turn.

## Model

The specific LLM, named within the selected Provider's namespace, that performs
the work of a Turn (e.g. `claude-sonnet-4-6` for Anthropic, `gpt-5.1` for
OpenAI). A workflow names exactly one Model; it is meaningful only in the context
of its Provider.

## Agent Backend

A Provider-specific implementation of the agent runner. Each Backend drives its
Provider's native agent SDK to execute a Turn and produces the same Agent Output
and token usage, so the rest of the system depends on the Backend's result, not
its Provider. Exactly one Backend is selected per workflow, chosen by Provider.

## Continuation Handle

An opaque, Provider-issued reference that carries an Issue's context from one Turn
to the next (an Anthropic session, an OpenAI conversation). The orchestrator
threads it across an Issue's Turns without interpreting it; the first Turn of an
Issue has none.

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
