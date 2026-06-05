# 035: OpenAI agent backend via `@openai/agents`

## Summary

Implement the `"openai"` `AgentRunner` backend using the **OpenAI Agents SDK**
(`@openai/agents`). It runs one Turn — agentic tool-use loop over the configured
MCP servers/tools — and maps the result to the same `TurnResult` the Anthropic
backend produces. Replaces the fail-fast stub from slice 034.

## Dependencies

- 034-provider-selection-seam (provides the selection entry point this fills in)

## Motivation

`@openai/agents` is a true peer of `@anthropic-ai/claude-agent-sdk`: agentic
loop, MCP tools, handoffs (≈ subagents), human-in-the-loop tool approval (≈ our
`permission_policy`), and conversation sessions (≈ `resume`). Because a Turn
surfaces output once at completion, the whole integration is "drive one run, then
produce a `TurnResult`" — no streamed message protocol. This makes OpenAI a
first-class execution provider selectable per workflow.

## Acceptance Criteria

- [ ] Add dependency `@openai/agents`.
- [ ] `makeOpenAiAgentRunner` implements `AgentRunner.runTurn` and returns the
      shared `TurnResult` shape. Behind the selection from 034, `provider:
      "openai"` resolves to it.
- [ ] Maps a single run to `TurnResult`:
  - `output` ← the run's final output text.
  - `success` / `exitCode` ← derived from run completion vs. error.
  - `sessionId` ← OpenAI continuation handle (conversation/thread/session id) so
    the worker can continue the next Turn.
  - `tokensUsed` ← run usage mapped to `TokenUsage`
    (`inputTokens`/`outputTokens`/`totalTokens`/`totalCostUsd` where available).
- [ ] Honours `AgentRunnerConfig`:
  - `model` → the OpenAI model for the run.
  - `maxTurns` → bound on the run's internal tool-use steps.
  - `mcpServers` → registered as MCP servers/tools for the run (reuse the
    existing `AgentMcpServerConfig` shape; translate stdio/http/sse).
  - `allowedTools` → restrict the tool set.
- [ ] **Tool `permission_policy` mapping** (resolve Q4): `always_allow` → auto-
      approve; `always_deny` → reject/omit; `always_ask` → since orchestration is
      non-interactive, treat as **deny** (documented) rather than blocking. Cover
      with a test.
- [ ] **Continuation:** given `params.resumeSessionId`, the run continues the
      prior conversation; first Turn starts fresh. Round-trips with the worker
      loop's `sessionId` threading (worker.ts) — add a test asserting the prior
      id is passed through and a new/updated id is surfaced.
- [ ] **Cancellation/timeout:** Effect interruption aborts the run (mirror the
      Anthropic `abortController` finalizer); per-Turn `timeoutMs` still maps to
      `TimedOut`.
- [ ] **Error mapping** to the provider-neutral `AgentError`: startup/auth
      failure → `SpawnFailed`; timeout → `TimedOut`; agent-reported failure →
      `NonZeroExit`; unexpected/missing result → `OutputParseFailed`.
- [ ] **Testability:** inject the run/runner function (mirror the Anthropic
      `query` injection in `AgentRunnerDependencies`) so tests provide a fake run.
      Tests: success + output, error result, token extraction, timeout,
      interruption/abort, session continuation, permission-policy mapping.
- [ ] `pnpm --filter symphony test` + `typecheck` + `lint` + `format:check` clean.

## Technical Notes

- Keep the same injection seam philosophy as the Anthropic backend: depend on an
  injected run function, default to the real `@openai/agents` entry point. Tests
  never hit the network.
- `TokenUsage` already has the right fields; write an `extractTokenUsage`
  equivalent for the OpenAI run-usage shape rather than forcing the Anthropic one.
- Do **not** change `TurnParams`/`TurnResult`/`AgentRunner` interface — the value
  of slice 034 is that this backend fits the existing contract.
- MCP translation: the `AgentMcpServerConfig` union (stdio | http/sse) already
  models what we need; map it to `@openai/agents` MCP server config, the analogue
  of `normalizeMcpServers` for Anthropic.
- Auth via `OPENAI_API_KEY` (wired/documented in slice 036).

## Files to Modify

```
packages/symphony/package.json                      # add @openai/agents
packages/symphony/src/agent/openai-runner.ts        # new: makeOpenAiAgentRunner
packages/symphony/src/agent/openai-runner.test.ts   # new: fake-run unit tests
packages/symphony/src/agent/runner.ts               # selection resolves "openai" → makeOpenAiAgentRunner
packages/symphony/src/agent/index.ts                # export the new backend if needed
packages/symphony/src/__tests__/mocks/agent.ts      # mock parity if the shared mock is provider-specific
```
