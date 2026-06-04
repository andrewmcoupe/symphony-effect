# TypeScript Symphony - Product Requirements Document

## Overview

TypeScript Symphony is a learning/reference implementation of the [OpenAI Symphony specification](https://github.com/openai/symphony/blob/main/SPEC.md) - a long-running orchestration service that polls an issue tracker, creates isolated per-issue workspaces, and runs coding-agent sessions to automate project work.

This implementation uses **Claude Code** as the coding agent (instead of OpenAI Codex) and is built with **Effect TS** for robust, typed, functional programming.

## Goals

- Implement core Symphony spec functionality for learning and reference
- Build a working orchestration service that can automate coding tasks from Linear issues
- Provide a real-time dashboard for observability
- Maintain spec compliance where applicable, adapting for Claude Code integration

## Non-Goals

- Production-hardened deployment (security hardening, container orchestration)
- SSH worker extension (Appendix A of spec)
- Multiple tracker implementations (GitHub Issues, Jira) - Linear only initially
- Multiple git provider implementations - GitHub only initially (abstraction allows future GitLab/Bitbucket)
- Tracker-side state transitions - the Linear↔GitHub integration moves issues to "In Review", not Symphony
- Persistent retry queue across restarts (in-memory only per spec)

---

## Technical Stack

### Runtime & Tooling

| Component | Choice |
|-----------|--------|
| Runtime | Node.js 22 LTS |
| Module format | ESM only |
| Package manager | pnpm 11 |
| Monorepo | pnpm workspaces |
| Language | TypeScript (strict mode) |

### Core Orchestrator (`packages/symphony`)

| Area | Library |
|------|---------|
| Core framework | Effect TS |
| Validation/Schema | Effect Schema |
| CLI parsing | @effect/cli |
| Agent invocation | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, `query()`) |
| Subprocess management (hooks) | @effect/platform (Command) |
| HTTP server | Hono |
| Git provider (PR creation) | GitHub REST API via `fetch` |
| YAML parsing | yaml |
| Front matter extraction | gray-matter |
| Template rendering | LiquidJS (strict mode) |
| Logging | Effect built-in logging |
| Testing | Vitest + @effect/vitest |

### Dashboard (`packages/dashboard`)

| Area | Library |
|------|---------|
| Build tool | Vite |
| Framework | React |
| Data fetching | TanStack Query |
| Routing | TanStack Router |
| Styling | Tailwind CSS |
| Components | shadcn/ui |

---

## Architecture

### Monorepo Structure

```
symphony-effect/
├── package.json                 # Workspace root
├── pnpm-workspace.yaml
├── packages/
│   ├── symphony/                # Core orchestrator
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts         # Entry point
│   │       ├── config/          # Workflow loader, typed config, schema
│   │       ├── tracker/         # Issue tracker abstraction + Linear impl
│   │       ├── git/             # Git provider abstraction + GitHub PR impl
│   │       ├── workspace/       # Workspace manager, hooks, path handling
│   │       ├── agent/           # Agent runner, Claude Code integration
│   │       ├── orchestrator/    # State machine, polling, dispatch, retries
│   │       └── observability/   # Logging, HTTP API
│   └── dashboard/               # React dashboard
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── routes/
│           └── components/
```

### Layer Composition (Dependency Graph)

```
ConfigLoader (no deps)
       │
       ▼
┌──────┴──────┬─────────────────┐
▼             ▼                 ▼
Logger    TrackerClient    WorkspaceManager
               │                 │
               └────────┬────────┘
                        ▼
                   AgentRunner
                        │
                        ▼
                   Orchestrator
                        │
                        ▼
                 HttpServer (Hono)
                        │
                        ▼
                      Main
```

Each layer can be tested independently by providing mock dependencies.

---

## Core Components

### 1. Config Loader

**Responsibility:** Parse `WORKFLOW.md` with YAML front matter and Markdown prompt body.

**Behavior:**
- Use `gray-matter` to extract front matter and content
- Parse YAML with `yaml` package
- Validate against Effect Schema with typed config
- Resolve `$VAR` environment variable references during validation
- Return typed config object and prompt template string
- Re-read and re-parse on each polling tick (no file watcher)

**Schema (from spec):**

```typescript
interface WorkflowConfig {
  tracker: {
    kind: "linear"
    endpoint?: string  // default: https://api.linear.app/graphql
    api_key: string    // supports $VAR resolution
    project_slug: string
    active_states: string[]      // e.g., ["Todo", "In Progress"]
    terminal_states: string[]    // e.g., ["Done", "Cancelled"]
  }
  polling: {
    interval_ms: number  // default: 30000
  }
  workspace: {
    root: string  // supports ~ and $VAR expansion
  }
  git?: {                            // optional; when absent, PR creation is disabled
    kind: "github"
    token: string                    // supports $VAR resolution
    repo: string                     // "owner/name"
    api_base_url?: string            // default: https://api.github.com (GHE override)
    base_branch?: string             // default: main
    branch_template?: string         // default: "symphony/{{ issue.identifier }}" (must match hooks)
    draft?: boolean                  // default: false
    title_template?: string          // default: "{{ issue.identifier }}: {{ issue.title }}"
    body_template?: string           // default: references issue identifier + url
  }
  hooks: {
    after_create?: string   // shell script
    before_run?: string
    after_run?: string
    before_remove?: string
    timeout_ms: number      // default: 60000
  }
  agent: {
    max_concurrent_agents: number      // default: 10
    max_turns: number                  // default: 20
    max_retry_backoff_ms: number       // default: 300000
    max_concurrent_agents_by_state?: Record<string, number>
  }
}
```

### 2. Issue Tracker Client

**Responsibility:** Fetch and normalize issues from Linear.

**Interface (abstraction for future trackers):**

```typescript
interface TrackerClient {
  fetchCandidateIssues(): Effect<Issue[], TrackerError>
  fetchIssuesByStates(states: string[]): Effect<Issue[], TrackerError>
  fetchIssueStatesByIds(ids: string[]): Effect<Map<string, string>, TrackerError>
}
```

**Issue Domain Model (normalized):**

```typescript
interface Issue {
  id: string
  identifier: string        // e.g., "ABC-123"
  title: string
  description: string
  priority: number | null
  state: string             // normalized case
  branch_name: string
  url: string
  labels: string[]          // lowercase
  blocked_by: BlockerRef[]
  created_at: string        // ISO-8601
  updated_at: string
}

interface BlockerRef {
  id: string
  identifier: string
  state: string
}
```

**Linear Implementation:**
- GraphQL client using `fetch`
- Auth via `Authorization` header with API token
- Project filtering by `slugId`
- Pagination (50 per page default)
- Blockers derived from inverse `blocks` relations

### 3. Workspace Manager

**Responsibility:** Manage per-issue isolated directories and lifecycle hooks.

**Behavior:**
- Sanitize identifier: replace non-`[A-Za-z0-9._-]` with `_`
- Compute path: `{workspace.root}/{sanitized_identifier}/`
- Create directory if missing, track `created_now` flag
- Run `after_create` hook only on new directories
- Run `before_run` hook before agent (failure aborts attempt)
- Run `after_run` hook after agent (failure logged, ignored)
- Run `before_remove` hook before cleanup (failure logged, ignored)
- Hooks execute via `sh -lc` with workspace as cwd
- Hook timeout enforcement (default 60s)

**Safety Invariants:**
- Workspace path must be under configured root (prefix check)
- Agent cwd must be the per-issue workspace path
- Path sanitization prevents directory traversal

### 4. Agent Runner

**Responsibility:** Launch Claude Code subprocess and manage turn execution.

**Invocation:** Claude Agent SDK `query()` (`@anthropic-ai/claude-agent-sdk`),
one `query()` call per Symphony turn.

```typescript
query({
  prompt: renderedPrompt,
  options: {
    cwd: workspacePath,
    permissionMode: "bypassPermissions",
    maxTurns,                 // caps the agent's internal tool-use loop
    model,                    // optional, from config
    resume: priorSessionId,   // undefined on the first turn
  },
})
```

**Behavior:**
- One `query()` call per Symphony turn; working directory = per-issue workspace
- **Session resume** (`options.resume` with the prior `session_id`) carries full
  context across turns — no re-priming each turn
- Structured `SDKResultMessage` provides result text, `is_error`, `usage`, and
  `total_cost_usd` natively (no stdout JSON parsing)
- Orchestrator decides whether to continue (based on issue state, turn count)
- Auth via `ANTHROPIC_API_KEY`; the SDK manages the underlying subprocess
- Effect interruption aborts the session via `AbortController` in a finalizer

**Turn Flow:**
1. Render prompt template with `{ issue, attempt }` variables
2. Call `query()` in the workspace directory (with `resume` after the first turn)
3. Consume the message stream; capture `session_id`, result, and usage
4. Return result (+ `sessionId`) to the orchestrator for its decision

**Concurrency note:** each session is a subprocess with cold-start overhead and a
practical rate-limit ceiling; keep `max_concurrent_agents` conservative.

### 5. Orchestrator

**Responsibility:** Single authority for polling, dispatch, state, retries, and reconciliation.

**State Model (using Effect Ref + tagged unions):**

```typescript
type IssueClaimState =
  | { _tag: "Unclaimed" }
  | { _tag: "Claimed"; claimedAt: number }
  | { _tag: "Running"; fiber: Fiber.RuntimeFiber<...>; startedAt: number; turnCount: number }
  | { _tag: "RetryQueued"; attempt: number; dueAt: number; error: string }

interface OrchestratorState {
  running: Map<string, RunningIssue>
  retryQueue: RetryEntry[]
  tokenTotals: TokenTotals
}
```

**Polling Loop (each tick):**
1. Re-read and validate WORKFLOW.md config
2. Reconcile running issues (stall detection + state refresh)
3. Process due retry entries
4. Fetch candidate issues from tracker
5. Sort: priority ascending, then oldest created_at
6. Dispatch eligible issues while slots available

**Dispatch Eligibility:**
- State in `active_states`, not in `terminal_states`
- Not already running or claimed
- Global concurrency available (Semaphore)
- Per-state concurrency available (counting from running map)
- If "Todo" state: no non-terminal blockers

**Concurrency Control:**
- Global: Effect `Semaphore` with `max_concurrent_agents` permits
- Per-state: Count from running map, check against `max_concurrent_agents_by_state[state]`

**Retry Logic:**
- Normal continuation: 1000ms delay after clean exit
- Failure retry: `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`
- Maintain explicit retry queue for observability
- Use Effect `Schedule.exponential` for delay calculation

**Reconciliation:**
- Stall detection: if no activity for `stall_timeout_ms`, terminate and retry
- State refresh: fetch current states for running issues
- Terminal state → stop worker, clean workspace
- No longer active → stop worker, no cleanup

**Worker Execution (per issue):**
1. Create/reuse workspace
2. Run `before_run` hook (failure aborts)
3. Loop: render prompt → run Claude Code turn → check issue state
   - First turn: full prompt
   - Continuation: may include previous context
   - Max `agent.max_turns` iterations
4. Run `after_run` hook (failure ignored)
5. Return result to orchestrator

### 6. Observability

**Logging:**
- Effect's built-in logging with structured context
- Context fields: `issue_id`, `issue_identifier`, `session_id`
- JSON formatter for production
- No secrets in logs

**HTTP API (Hono):**

```
GET  /api/v1/state              # Full orchestrator snapshot
GET  /api/v1/issues/:identifier # Issue-specific details
POST /api/v1/refresh            # Trigger immediate poll
```

### 7. Git Provider (Pull Requests)

**Responsibility:** Open a pull request for an issue's work branch once an agent
session has pushed changes, abstracting over git hosting providers (GitHub first).

**Interface (abstraction for future providers):**

```typescript
interface GitProvider {
  findOpenPullRequest(headBranch: string): Effect<PullRequestRef | null, GitProviderError>
  ensurePullRequest(params: OpenPullRequestParams): Effect<PullRequestRef | null, GitProviderError>
}
```

**Behavior:**
- GitHub implementation uses the REST API via `fetch` with `$GITHUB_TOKEN` (Bearer auth)
- `ensurePullRequest` is find-or-create (idempotent — no duplicate PRs across turns)
- Benign skips return `null`: no commits between base/head, or branch missing on remote
- Invoked by the orchestrator after `Completed` / `MaxTurnsReached`, once `after_run` has pushed
- PR creation failures are logged and ignored (never fail dispatch)
- When the `git` config section is absent, a no-op provider disables PR creation

**In Review transition (out of scope for Symphony):**
- Symphony does **not** mutate the tracker. It opens a PR that references the
  issue (via head branch name and/or the issue identifier in the PR body).
- The user configures Linear's GitHub integration + an automation ("move to
  In Review when a linked PR is opened") to perform the transition.
- `In Review` must **not** be listed in `active_states`; once Linear moves the
  issue there, Symphony's existing state check stops processing it.

**Snapshot Response:**

```typescript
interface StateSnapshot {
  running: {
    issue_id: string
    identifier: string
    turn_count: number
    started_at: string
    elapsed_ms: number
  }[]
  retrying: {
    issue_id: string
    identifier: string
    attempt: number
    due_at: string
    error: string
  }[]
  token_totals: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    runtime_seconds: number
  }
  config: {
    polling_interval_ms: number
    max_concurrent_agents: number
  }
}
```

---

## Dashboard

### Routes

| Route | View |
|-------|------|
| `/` | Overview - running agents, retry queue, totals |
| `/issues/:identifier` | Issue detail - history, logs, current state |

### Features

- Real-time updates via TanStack Query polling (5s interval)
- Running agents list with status indicators
- Retry queue with countdown timers
- Token usage totals
- Issue state badges (using shadcn/ui)

---

## CLI Interface

**Start orchestrator:**

```bash
symphony ./WORKFLOW.md
symphony ./WORKFLOW.md --port 3000  # Enable HTTP server
```

**Arguments:**
- Positional: workflow file path (default: `./WORKFLOW.md`)
- `--port`: HTTP server port (enables API + serves dashboard)

**Exit Codes:**
- 0: Clean shutdown
- 1: Startup failure (invalid config, missing deps)
- Non-zero: Abnormal termination

---

## Startup Sequence

1. Parse CLI arguments (`@effect/cli`)
2. Configure Effect logging
3. Load and validate WORKFLOW.md
4. Build service layers (Config → Tracker → Workspace → Agent → Orchestrator)
5. Query terminal issues, clean stale workspaces
6. Start HTTP server if `--port` specified
7. Schedule first polling tick
8. Enter Effect runtime event loop

---

## Graceful Shutdown

On SIGINT/SIGTERM:
1. Stop accepting new dispatches
2. Let running agents complete current turn (single-turn anyway)
3. Wait up to 30 seconds
4. Force kill any remaining subprocesses
5. Clean up resources via Effect Scope
6. Exit

---

## Error Handling

**Error Categories (typed with Effect):**

```typescript
type SymphonyError =
  | ConfigError        // File missing, invalid YAML, validation failure
  | TrackerError       // API transport, auth, GraphQL errors
  | WorkspaceError     // Directory creation, hook failure, path validation
  | AgentError         // Subprocess spawn, timeout, parse failure
  | ObservabilityError // HTTP server, logging sink failure
```

**Recovery Behavior:**
- Config validation failure → block dispatch, keep reconciliation, stay alive
- Worker failure → exponential backoff retry
- Tracker fetch failure → skip tick, retry next poll
- State refresh failure → keep workers, retry next tick
- Observability failure → log warning, do not crash

---

## Testing Strategy

### Unit Tests
- Config schema validation (valid/invalid YAML, env var resolution)
- Path sanitization
- Retry backoff calculation
- State machine transitions
- Prompt template rendering

### Integration Tests
- Workspace creation and hook execution
- Linear GraphQL client (with mocked responses)
- Claude Code subprocess invocation (with mock)
- Full polling loop (with mock tracker and agent)

### E2E Tests (Manual/Optional)
- Real Linear API with test project
- Real Claude Code execution
- Dashboard interaction

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Monorepo setup (pnpm workspaces, tsconfig, eslint)
- [ ] Effect project structure with domain folders
- [ ] Config loader with Effect Schema validation
- [ ] Basic CLI with @effect/cli

### Phase 2: Tracker Integration
- [ ] Tracker abstraction interface
- [ ] Linear GraphQL client implementation
- [ ] Issue normalization and pagination

### Phase 3: Workspace Management
- [ ] Workspace path sanitization and creation
- [ ] Hook execution with timeout
- [ ] Cleanup on terminal state

### Phase 4: Agent Runner
- [ ] Claude Code subprocess invocation
- [ ] JSON output parsing
- [ ] Turn execution with proper cleanup

### Phase 5: Orchestrator Core
- [ ] State machine with Ref + tagged unions
- [ ] Polling loop implementation
- [ ] Dispatch eligibility and sorting
- [ ] Concurrency control (Semaphore + counting)

### Phase 6: Retries & Reconciliation
- [ ] Retry queue with exponential backoff
- [ ] Stall detection
- [ ] State refresh and workspace cleanup

### Phase 7: Observability API
- [ ] Hono HTTP server setup
- [ ] Snapshot API endpoints
- [ ] Structured logging with context

### Phase 8: Dashboard
- [ ] Vite + React + TanStack setup
- [ ] TanStack Query data fetching
- [ ] TanStack Router for routes
- [ ] shadcn/ui components
- [ ] Overview and issue detail views

### Phase 9: Agent SDK Migration & Pull Request Integration
- [ ] Migrate agent runner to the Claude Agent SDK (session resume, native usage) — task 030
- [ ] Git provider abstraction (interface, errors, config) — task 027
- [ ] GitHub REST pull request client — task 028
- [ ] Open PR on worker completion + example/docs — task 029

### Phase 10: Polish
- [ ] Graceful shutdown handling
- [ ] Error recovery hardening
- [ ] Documentation
- [ ] Example WORKFLOW.md

---

## Example WORKFLOW.md

```yaml
---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled

polling:
  interval_ms: 30000

workspace:
  root: ~/symphony-workspaces

hooks:
  after_create: |
    git clone git@github.com:myorg/myrepo.git .
    pnpm install
  before_run: |
    git fetch origin
    git checkout -B symphony/$ISSUE_IDENTIFIER origin/main
  after_run: |
    git add -A
    git commit -m "Symphony: $ISSUE_IDENTIFIER" || true
    git push -u origin symphony/$ISSUE_IDENTIFIER || true

agent:
  max_concurrent_agents: 5
  max_turns: 10
  max_retry_backoff_ms: 300000
---

You are an autonomous coding agent working on issue {{ issue.identifier }}.

## Issue Details
- **Title:** {{ issue.title }}
- **Description:** {{ issue.description }}
- **Priority:** {{ issue.priority | default: "None" }}
- **Labels:** {{ issue.labels | join: ", " }}

## Instructions
1. Understand the requirements from the issue description
2. Explore the codebase to find relevant files
3. Implement the requested changes
4. Write or update tests as needed
5. Ensure the code compiles and tests pass

{% if attempt %}
This is retry attempt {{ attempt }}. The previous attempt failed. Please review what went wrong and try a different approach.
{% endif %}
```

---

## Open Questions

1. ~~**Claude Code output format**~~ — Resolved: the Agent SDK returns typed `SDKResultMessage`s (no stdout parsing). See Agent Runner.
2. ~~**Turn continuation context**~~ — Resolved: resume by `session_id` carries context across turns (`options.resume`).
3. ~~**Token counting**~~ — Resolved: `usage` + `total_cost_usd` come from the SDK result message.
4. **Dashboard authentication:** Should the dashboard require auth? (Probably no for reference impl)
5. **Agent concurrency ceiling:** What `max_concurrent_agents` is safe given per-session subprocess overhead and API rate limits? (tune empirically)

---

## References

- [Symphony Specification](https://github.com/openai/symphony/blob/main/SPEC.md)
- [Effect TS Documentation](https://effect.website/)
- [Linear GraphQL API](https://developers.linear.app/docs/graphql/working-with-the-graphql-api)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
