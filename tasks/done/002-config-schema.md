# 002: Config Schema & Validation

## Summary
Define the Effect Schema for WORKFLOW.md configuration with environment variable resolution.

## Dependencies
- 001-project-setup

## Acceptance Criteria

- [x] `WorkflowConfig` schema defined with all fields from spec:
  - `tracker` (kind, endpoint, api_key, project_slug, active_states, terminal_states)
  - `polling` (interval_ms)
  - `workspace` (root)
  - `hooks` (after_create, before_run, after_run, before_remove, timeout_ms)
  - `agent` (max_concurrent_agents, max_turns, max_retry_backoff_ms, max_concurrent_agents_by_state)
- [x] Default values applied:
  - `tracker.endpoint`: `https://api.linear.app/graphql`
  - `polling.interval_ms`: `30000`
  - `hooks.timeout_ms`: `60000`
  - `agent.max_concurrent_agents`: `10`
  - `agent.max_turns`: `20`
  - `agent.max_retry_backoff_ms`: `300000`
- [x] Environment variable resolution (`$VAR` syntax) via Schema transform
- [x] Path expansion (`~` for home directory)
- [x] Typed error for missing env vars: `ConfigError.MissingEnvVar`
- [x] Typed error for validation failures: `ConfigError.ValidationFailed`
- [x] Unit tests for:
  - Valid config parsing
  - Default value application
  - `$VAR` resolution (success and missing)
  - `~` expansion
  - Invalid config rejection

## Technical Notes

- Use `Schema.transform` for env var resolution
- Use `Schema.optional` with `Schema.withDefault` for defaults
- Validate `tracker.kind` is `"linear"` (only supported tracker)
- `active_states` and `terminal_states` should be non-empty arrays

## Files to Create

```
packages/symphony/src/config/
├── schema.ts          # Effect Schema definitions
├── errors.ts          # ConfigError type
├── index.ts           # Public exports
└── schema.test.ts     # Unit tests
```

## Example Schema Usage

```typescript
import { Schema } from "@effect/schema"
import { Effect } from "effect"

const rawConfig = { tracker: { kind: "linear", api_key: "$LINEAR_API_KEY", ... } }
const result = Schema.decodeUnknown(WorkflowConfig)(rawConfig)
// Effect<WorkflowConfig, ParseError>
```
