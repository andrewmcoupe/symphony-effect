# 030: Migrate Agent Runner to the Claude Agent SDK

## Summary
Replace the `claude -p "<prompt>" --output-format json` subprocess in the agent
runner with the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, `query()`).
This gives structured result messages (no JSON parsing), native token/cost usage,
and **session resume** for real multi-turn continuation. Refactors task 009 and
reshapes the worker loop from task 014.

## Dependencies
- 009-agent-runner (replaces its implementation)
- 014-worker-execution (worker loop threads the session id across turns)

## Motivation

Resolves three PRD Open Questions outright:
- **#1 output format** — `query()` yields typed `SDKResultMessage`s; delete the
  hand-rolled `ClaudeJsonOutput` parsing.
- **#2 turn continuation** — `resume: sessionId` carries full context between
  turns instead of today's "every turn is a fresh, context-free subprocess".
- **#3 token counting** — `message.usage` + `total_cost_usd` come back natively
  (the existing `TokenUsage` type already has these fields).

## Acceptance Criteria

- [x] Add dependency `@anthropic-ai/claude-agent-sdk`; remove the runner's
      dependence on `@effect/platform` `Command` / `CommandExecutor`
      (hooks still use `@effect/platform`, leave those untouched).
- [x] `runTurn` is implemented via `query()`:
  - `options.cwd` = `workspacePath`
  - `options.permissionMode` = `"bypassPermissions"` (non-interactive orchestration)
  - `options.maxTurns` bounds internal tool-use rounds per call (config-driven)
  - `options.model` from config when set (see config additions)
  - `options.resume` = prior session id when continuing (see below)
  - `options.abortController` wired so Effect interruption aborts the session
- [x] `TurnParams` extended:
  ```typescript
  interface TurnParams {
    prompt: string
    workspacePath: string
    timeoutMs: number
    resumeSessionId?: string   // null/undefined on first turn
  }
  ```
- [x] `TurnResult` extended to surface the session id for continuation:
  ```typescript
  interface TurnResult {
    success: boolean
    output: string
    sessionId?: string         // captured from the init/system message
    tokensUsed?: TokenUsage
    // exitCode dropped (no subprocess); or kept as 0/1 derived from is_error
  }
  ```
- [x] Map the SDK message stream → `TurnResult`:
  - capture `session_id` from the `system`/`init` message
  - `success` = result message `subtype !== "error"` and `is_error !== true`
  - `output` = result message `result` text
  - `tokensUsed` from `usage` + `total_cost_usd` (reuse `extractTokenUsage` shape)
- [x] Worker loop (worker.ts) threads continuation:
  - first turn: no `resumeSessionId`
  - subsequent turns: pass the previous `TurnResult.sessionId`
  - continuation prompts may be shorter (context is in the session)
- [x] `AgentError` mapping preserved/updated:
  - SDK init/spawn failure → `SpawnFailed`
  - per-call timeout (Effect `timeoutFail`) → `TimedOut`
  - error result message → `NonZeroExit` (or rename to `AgentReportedError`)
  - unexpected message shape → `OutputParseFailed`
- [x] Auth via `ANTHROPIC_API_KEY` (documented in README + example env).
- [x] Testability: inject the `query` function (like `fetch`/`CommandExecutor`
      are injected elsewhere) so tests provide a fake async iterator. Rewrite
      `runner.test.ts`: success, error result, token extraction, timeout,
      interruption/abort, session-id capture, resume passthrough.
- [x] `AgentRunnerLive` no longer requires `CommandExecutor`; `NodeAgentRunnerLive`
      simplified accordingly. Update `layers.ts` wiring.

## Config Additions (config/schema.ts)

```yaml
agent:
  # ... existing ...
  model: claude-sonnet-4-6        # optional; SDK default when omitted
  max_turns: 15                   # now maps to SDK options.maxTurns per call
```

## Technical Notes

- The SDK **still spawns a subprocess** (bundles the `claude` binary) and authes
  via `ANTHROPIC_API_KEY` — this is a *typed, session-aware* subprocess, not a
  direct API call. Wrap the async iterator with `Stream.fromAsyncIterable` /
  `Effect.tryPromise`; on interrupt, call `abortController.abort()` in a finalizer
  (replaces the current `killIfRunning`).
- Symphony's notion of a "turn" stays = one `query()` call. Keep the per-call
  Effect timeout; `options.maxTurns` separately caps the agent's internal loop.
- ⚠️ **Concurrency caveat (affects `max_concurrent_agents`):** per-session
  subprocess, ~12s cold-start per call, and a documented rate-limit ceiling at
  ~5–6 concurrent sessions. Keep `max_concurrent_agents` conservative; consider
  the SDK `startup()` pre-warm later. Note this in docs.
- Session transcripts persist under `~/.claude/projects/` on local disk; fine for
  a single-host reference impl. Cross-host durability (SessionStore) is out of scope.
- Do not enable MCP servers here — tracker reads stay on the typed Linear client
  (control plane) and PR creation stays the deterministic GitHub client (027–029).

## Files to Modify

```
packages/symphony/package.json                      # add @anthropic-ai/claude-agent-sdk
packages/symphony/src/agent/runner.ts               # query()-based implementation
packages/symphony/src/agent/types.ts                # TurnParams/TurnResult additions
packages/symphony/src/agent/errors.ts               # error mapping updates
packages/symphony/src/agent/runner.test.ts          # rewrite around fake query()
packages/symphony/src/config/schema.ts              # agent.model (+ tests)
packages/symphony/src/orchestrator/worker.ts        # thread sessionId across turns
packages/symphony/src/layers.ts                     # drop CommandExecutor from runner wiring
packages/symphony/src/__tests__/mocks/agent.ts      # update mock to new shape
```
