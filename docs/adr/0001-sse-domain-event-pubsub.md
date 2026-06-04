# 1. SSE dashboard updates via a domain-event PubSub and signal-based invalidation

Date: 2026-06-04

Status: Accepted

## Context

The dashboard reads orchestrator state by polling two REST endpoints
(`GET /api/v1/state`, `GET /api/v1/issues/:identifier`) on a 5s
`refetchInterval`. The most latency-sensitive thing a human watches — an agent's
per-Turn output — therefore lags by up to 5s.

Constraints that shaped the decision:

- Orchestrator state lives in a single plain `Ref.Ref<OrchestratorState>`
  (`orchestrator/state/ref.ts`) with **no** change-notification channel. All
  mutations flow through pure `state → state` functions, and the only call
  sites are inside the orchestrator/worker.
- The agent runner (`collectQueryResult`) only surfaces output at Turn
  completion; there is no intra-Turn stream to forward.
- `CLAUDE.md` mandates TanStack Query as the network-state layer — any push
  channel must feed the query cache, not bypass it.
- The server already owns non-trivial projection logic
  (`toStateSnapshot` / `toIssueDetail`).

We want near-real-time dashboard updates for **Agent Output** and **Issue State**
changes (see [CONTEXT.md](../../CONTEXT.md)) without a runner rewrite and without
the orchestrator ever blocking on a slow dashboard.

## Decision

Push updates over **Server-Sent Events**, structured as follows:

1. **Emission** — add an Effect `PubSub<DomainEvent>` co-located with the state
   ref. The ref's mutation methods publish semantic Domain Events
   (`TurnRecorded`, `IssueStateChanged`) as a side effect, so no call sites
   change. `incrementTokens` / `updateActivity` / `recordPoll` publish nothing.

2. **Back-pressure** — the PubSub uses the **sliding** strategy. A slow or
   wedged subscriber drops its oldest events; the publisher (orchestrator
   mutation) never blocks.

3. **Transport** — a single global `GET /api/v1/events` SSE endpoint in the
   existing Hono app (gated on `--port`). Each connection scopes one
   `PubSub.subscribe`; a forked fiber dequeues to `streamSSE` with a ~20s
   heartbeat and is torn down on abort.

4. **Events are thin signals** — `{ type, identifier }`, carrying no state. The
   client (`EventSource` via a root `useOrchestratorEvents()` hook) reacts by
   invalidating the `["orchestrator"]` query-key prefix; TanStack Query refetches
   through the existing REST projection, which stays the single source of truth.

5. **Resilience** — on (re)connect the client invalidates once to resync (no
   `Last-Event-ID` / replay needed, because signals are idempotent). The 5s
   interval is dropped while SSE is healthy; a ~30s safety-net `refetchInterval`
   plus `refetchOnReconnect` backstops a silently dead stream.

## Consequences

- Agent-output and state-transition latency drops from ~5s to near-zero, with
  far less steady-state polling.
- The orchestrator is insulated from dashboard health by the sliding PubSub.
- Exactly one projection (server REST) — no client-side state shape to drift.
- Per-turn cadence means the extra refetch per event is negligible at solo/local
  scale; the coarse `["orchestrator"]` invalidation is intentionally simple.

## Alternatives considered

- **`SubscriptionRef.changes`** — near-mechanical `Ref` swap, but emits the
  whole state on *every* mutation (incl. token/activity noise) and forces the
  route to diff whole snapshots to recover what happened. Lossy semantics,
  noisier. Rejected in favour of explicit Domain Events.
- **Fat events + `setQueryData`** — lowest latency, but duplicates the server
  projection on the client and risks cache drift. Rejected; the latency edge is
  immaterial at per-Turn cadence.
- **Server-side diff polling** — keep `Ref`, poll `getSnapshot` in the SSE
  handler, emit on diff. Just relocates polling; keeps the latency floor.
  Rejected.
- **Bounded PubSub** — back-pressures publishers, so a wedged dashboard tab
  could stall orchestrator state mutations. Rejected as unsafe.
- **SSE-only (no fallback poll)** — leanest, but a silently wedged stream leaves
  the UI stale with no backstop. Rejected in favour of a slow safety net.
