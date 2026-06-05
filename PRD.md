# PRD: Provider-Agnostic Agent Execution (Anthropic + OpenAI)

## Goal

Let a workflow choose **which provider and model does the work** by setting
`agent.provider` + `agent.model` in `WORKFLOW.md`. Scope for this project is the
two providers that reliably drive multi-turn coding agents — **Anthropic** (via
`@anthropic-ai/claude-agent-sdk`, already in use) and **OpenAI** (via
`@openai/agents`) — each through its **native** agent SDK.

> "Stick to supporting just OpenAI and Anthropic for now using the two SDKs."

## Background — how execution works today

- The agent runner (`packages/symphony/src/agent/runner.ts`) is built on
  `@anthropic-ai/claude-agent-sdk`'s `query()`: the agentic tool-use loop, MCP
  client, session `resume`, permission modes, and a typed message stream. It is
  the *worker*, not a thin HTTP client.
- `AgentRunner` is already a `Context.GenericTag` whose single method is
  `runTurn(params) => Effect.Effect<TurnResult, AgentError>`. `agent.model` flows
  `WORKFLOW.md` → `AgentConfig` → `options.model` → `query()`, but `query()` only
  understands Anthropic model ids, so a non-Anthropic `model` is ignored today.

## Why this is cheaper than it looks (key findings)

1. **The seam already exists.** `AgentRunner` (a `Tag` returning `TurnResult`) is
   provider-neutral in shape. A second provider is "another `AgentRunner`
   implementation that returns a `TurnResult`" — not a new abstraction.
2. **No streamed message protocol needed.** Per `CONTEXT.md`, a **Turn** surfaces
   output *once, at completion* (no intra-Turn token stream). So `TurnResult` is
   the entire normalization target for any backend.
3. **`@openai/agents` is a true peer of claude-agent-sdk** — agentic loop, MCP
   tools, handoffs (≈ subagents), human-in-the-loop tool approval (≈ our tool
   `permission_policy`), and sessions/conversation history (≈ `resume`). So the
   concepts symphony already models map across both SDKs, making the `TurnResult`
   adapter a like-for-like translation rather than a rebuild.
4. **Testability pattern is established.** The Anthropic runner injects its
   `query` function (`AgentRunnerDependencies.query`) so tests feed a fake async
   iterator. The OpenAI backend mirrors this — inject the run/runner function.

## Design

- **`agent.provider`** selects the backend (`"anthropic"` default | `"openai"`).
  Absent ⇒ today's exact behaviour, no change.
- **`agent.model`** is interpreted in the selected provider's namespace
  (`claude-sonnet-4-6` for anthropic, e.g. `gpt-5.1` for openai).
- **`AgentRunner` is the provider boundary.** Selection happens once at layer
  construction (`makeMainLive`); the orchestrator/worker depend only on the
  `AgentRunner` tag and `TurnResult` — they never learn which provider ran.
- **`TurnResult` is unchanged** (`success`, `output`, `exitCode?`, `sessionId?`,
  `tokensUsed?`). `sessionId` carries whatever continuation handle the backend
  uses (Anthropic session id, or OpenAI conversation/thread id).
- **Errors stay tagged but become provider-neutral.** `AgentError`
  (`SpawnFailed | TimedOut | OutputParseFailed | NonZeroExit`) is shared; messages
  currently say "Claude Code" and must be made provider-aware.
- **Auth per provider:** `ANTHROPIC_API_KEY` (existing) / `OPENAI_API_KEY` (new).

```yaml
agent:
  provider: openai            # NEW — "anthropic" (default) | "openai"
  model: gpt-5.1              # interpreted in the provider's namespace
  max_turns: 15
  # mcp_servers / allowed_tools apply to both providers
```

## Non-goals

- Gateways / Anthropic-compatible proxies (OpenRouter, HF). Considered and
  **deferred** — the Anthropic-skin translation puts non-Claude tool-use through
  a lossy layer; we want native tool-call fidelity, so we use each provider's own
  SDK instead.
- OpenHands SDK. Considered; **deferred** — its TS client is alpha and the Python
  path forces a REST/service boundary. Revisit when the TS client matures.
- A third+ provider, a gateway fallback, or a generic per-provider HTTP client.
- A streamed / token-level agent message protocol (domain is Turn-granular).
- Cross-host session durability (session handles stay local, per task 030).

## Open questions

- **Q1 — OpenAI tool-use across many turns.** Does an OpenAI model drive
  symphony's MCP loop across many Turns as reliably as Claude? Validate with a
  real Issue once slice 035 lands.
- **Q2 — Token / cost accounting.** `@openai/agents` reports usage differently
  from claude-agent-sdk; confirm `TokenUsage` (`inputTokens`/`outputTokens`/
  `totalCostUsd`) populates so `TokenTotalsChanged` events stay meaningful.
- **Q3 — Continuation semantics.** Anthropic uses `options.resume` (session id);
  OpenAI continuation is conversation-history/thread based. Confirm
  `resumeSessionId ↔ TurnResult.sessionId` round-trips for the OpenAI backend in
  the worker loop (worker.ts threads it across Turns).
- **Q4 — Tool-policy parity.** Map our `permission_policy`
  (`always_allow`/`always_ask`/`always_deny`) onto `@openai/agents` tool approval.
  `always_ask` has no interactive operator in non-interactive orchestration —
  decide its meaning (treat as deny? as allow? config error?).

## Vertical slices

| # | Slice | Depends on |
|---|-------|-----------|
| 034 | Provider selection seam + `agent.provider` config; extract current runner as the **Anthropic** backend; provider-neutral `AgentError`. Default behaviour unchanged. | — |
| 035 | **OpenAI** `AgentRunner` backend via `@openai/agents`, returning `TurnResult` (model, MCP, tools, continuation, usage, error mapping). Injected runner for tests. | 034 |
| 036 | Wire provider selection in `layers.ts`, `OPENAI_API_KEY` auth, docs + example workflow, per-provider compatibility notes. End-to-end `provider: openai` run. | 034, 035 |
