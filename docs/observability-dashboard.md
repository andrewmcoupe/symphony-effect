# Observability and Dashboard

Symphony exposes an HTTP API for the dashboard and operational visibility. The
API is intentionally small and backed by the in-memory orchestrator state.

## HTTP API

Routes are defined in
[`observability/routes.ts`](../packages/symphony/src/observability/routes.ts).
Server startup lives in
[`observability/server.ts`](../packages/symphony/src/observability/server.ts).

Current routes:

- `GET /api/v1/state`: running issues, retry queue, token totals, config, recent
  outputs, shutdown flag.
- `GET /api/v1/issues/:identifier`: issue detail for running, retrying, or idle
  known issues.
- `POST /api/v1/refresh`: request an immediate orchestrator refresh.

The API starts only when the CLI receives `--port`.

## Dashboard

The React dashboard lives in
[`packages/dashboard/src`](../packages/dashboard/src).

Important areas:

- API client: [`api/client.ts`](../packages/dashboard/src/api/client.ts)
- API types: [`api/types.ts`](../packages/dashboard/src/api/types.ts)
- TanStack Query hooks: [`hooks`](../packages/dashboard/src/hooks)
- Overview route: [`routes/index.tsx`](../packages/dashboard/src/routes/index.tsx)
- Issue route: [`routes/issues/$identifier.tsx`](../packages/dashboard/src/routes/issues/$identifier.tsx)

The dashboard is read-oriented except for refresh. It does not currently expose
manual retry, cancel, or status mutation controls.

## Token Metrics

The agent runner extracts token usage fields from Claude Agent SDK result
messages:

- input tokens,
- output tokens,
- cache creation input tokens,
- cache read input tokens,
- total tokens,
- total cost USD when present.

State currently aggregates input, output, total tokens, and runtime seconds.
Cache token fields are parsed at the runner boundary but are not yet broken out
in dashboard totals.

## Current Limitations

- API has no auth.
- State is in memory.
- Recent output retention is state-bound rather than durable.
- No per-model or per-project cost breakdown.
- No persistent run history.

For local solo use, this is acceptable. For shared deployment, put the API
behind private networking or add auth before exposing it.

