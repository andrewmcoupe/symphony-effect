# 034: Provider selection seam + `agent.provider` config

## Summary

Introduce a provider boundary in front of the agent runner so a workflow can
later pick which provider executes a Turn, **without changing today's behaviour**.
Add an `agent.provider` config field (`"anthropic"` default | `"openai"`), make
the runner selectable by it, and re-frame the existing `@anthropic-ai/claude-agent-sdk`
implementation as the explicit **Anthropic backend**. No OpenAI code yet — this
slice is the keystone refactor that everything else hangs off.

## Dependencies

- 030-agent-sdk-runner (the claude-agent-sdk runner this slice re-frames)

## Motivation

`AgentRunner` is already a `Context.GenericTag` returning `TurnResult`, so it is
provider-neutral *in shape* — but its only implementation, its config
(`AgentRunnerConfig`), and its errors (`"Claude Code …"`) all assume Anthropic.
Before adding a second provider we make the seam explicit and provider-neutral,
keeping the Anthropic path byte-for-byte equivalent as the default. This de-risks
slice 035: adding OpenAI becomes "implement the seam", not "untangle Anthropic".

## Acceptance Criteria

- [ ] `AgentConfig` (config/schema.ts) gains
      `provider: Schema.optionalWith(Schema.Literal("anthropic", "openai"), { default: () => "anthropic" })`.
      Add schema tests: default is `"anthropic"`; `"openai"` decodes; an unknown
      provider is a `ValidationFailed`.
- [ ] `AgentRunnerConfig` (runner.ts) carries `readonly provider: "anthropic" | "openai"`.
- [ ] A selection function chooses the backend by `provider`:
  - `"anthropic"` → the current `makeAgentRunner` implementation (unchanged).
  - `"openai"` → **not implemented in this slice**; fail loudly and early with a
    clear typed error (e.g. `SpawnFailed` carrying "openai backend not yet
    implemented", or a dedicated `UnsupportedProvider` tagged error) so it can
    never silently fall back to Anthropic.
- [ ] The existing Anthropic implementation is extracted/renamed to read as a
      named backend (e.g. `makeAnthropicAgentRunner`) while keeping
      `makeAgentRunner` / `makeAgentRunnerLive` as the public selection entry
      point. All current `runner.test.ts` cases pass unchanged.
- [ ] `AgentError` messages (errors.ts) made provider-neutral: replace hard-coded
      "Claude Code" with neutral wording (e.g. "agent") or a provider field on
      the error. Update any assertions in tests that match on message text.
- [ ] `makeMainLive` (layers.ts) passes `provider: loaded.config.agent.provider`
      into `makeAgentRunnerLive`. With no `provider` in YAML, wiring resolves to
      the Anthropic backend and the app behaves exactly as today.
- [ ] No behavioural change for existing workflows: full `pnpm --filter symphony
      test` green; `typecheck`, `lint`, `format:check` clean.

## Config Additions (config/schema.ts)

```yaml
agent:
  provider: anthropic   # NEW; "anthropic" (default) | "openai"
  model: claude-sonnet-4-6
  # ... existing fields unchanged ...
```

## Technical Notes

- Keep `provider` selection at **construction time** (`makeAgentRunnerLive` /
  `makeMainLive`), not inside `runTurn`. The worker/orchestrator continue to
  depend only on the `AgentRunner` tag and `TurnResult`.
- This slice intentionally ships an `"openai"` value that fails fast. That failure
  is replaced by a real backend in 035 — a deliberate RED marker, not dead code.
- Prefer a dedicated `UnsupportedProvider` tagged error over overloading
  `SpawnFailed` if it reads cleaner with the existing `AgentError` union; if
  added, export it from the union and cover it in tests.
- Do not touch MCP normalization, token extraction, or the worker session
  threading here — they are shared and provider-neutral already.

## Files to Modify

```
packages/symphony/src/config/schema.ts            # agent.provider literal + default
packages/symphony/src/config/schema.test.ts       # provider decode/default/invalid
packages/symphony/src/agent/runner.ts             # provider on config; selection entry; extract Anthropic backend
packages/symphony/src/agent/errors.ts             # provider-neutral messages (+ UnsupportedProvider if added)
packages/symphony/src/agent/runner.test.ts        # keep green; neutral message assertions; openai-fails-fast case
packages/symphony/src/layers.ts                   # thread provider into makeAgentRunnerLive
docs/workflow-configuration.md                    # document agent.provider
```
