# 036: Provider wiring, auth, and docs

## Summary

Tie the two backends together end-to-end: select the provider at layer
construction, wire `OPENAI_API_KEY` auth, document `agent.provider` across the
config docs / example workflows / env example, and record a per-provider
compatibility note. After this slice, a workflow with `provider: openai` runs a
real Issue end-to-end through `@openai/agents`.

## Dependencies

- 034-provider-selection-seam
- 035-openai-agents-backend

## Motivation

Slices 034–035 build the seam and the OpenAI backend; this slice makes the
feature usable and discoverable. It also closes Q1 (does an OpenAI model drive
the MCP loop across Turns?) by exercising a real run, and documents the auth and
config story so workflow authors can adopt it without reading source.

## Acceptance Criteria

- [ ] `makeMainLive` (layers.ts) selects and provides the correct `AgentRunner`
      from `loaded.config.agent.provider`; the orchestrator/worker are unchanged
      and provider-unaware.
- [ ] Auth: `OPENAI_API_KEY` consumed by the OpenAI backend; `ANTHROPIC_API_KEY`
      remains for Anthropic. Missing key for the selected provider fails with a
      clear, typed error at startup (not mid-run).
- [ ] `.env.example` documents both keys with a note that only the selected
      provider's key is required.
- [ ] `docs/workflow-configuration.md` documents `agent.provider` (values,
      default, that `agent.model` is the provider's namespace, and that
      `mcp_servers` / `allowed_tools` apply to both).
- [ ] An example workflow demonstrates the OpenAI provider (e.g.
      `examples/WORKFLOW.openai.md` or a documented variant) with
      `provider: openai` + a real OpenAI `model`.
- [ ] A short **provider compatibility** note (docs) records what was verified per
      provider — tool-use across Turns, token/cost reporting (Q2), continuation
      (Q3), and the `always_ask → deny` decision (Q4).
- [ ] **End-to-end validation (Q1):** run one real Issue through `provider:
      openai` against a live OpenAI model and confirm: the MCP tool loop holds
      across multiple Turns, `TurnRecorded` Agent Output is populated, and
      `TokenTotalsChanged` reflects real usage. Capture the outcome in the
      compatibility note.
- [ ] `pnpm --filter symphony test` + `typecheck` + `lint` + `format:check` clean;
      dashboard tests run if touched.

## Technical Notes

- Selection lives in `makeMainLive` only; do not leak `provider` into downstream
  layers. Everything below the `AgentRunner` tag stays provider-agnostic.
- The end-to-end check is a manual/integration validation (live API key), not a
  unit test — gate any committed integration test behind an env guard like the
  existing integration suites (see task 026).
- If Q2/Q3/Q4 surface gaps during validation, prefer a follow-up slice over
  expanding this one; keep the wiring slice scoped.

## Files to Modify

```
packages/symphony/src/layers.ts                   # provider-driven AgentRunner selection + auth guard
.env.example                                      # OPENAI_API_KEY (+ note)
docs/workflow-configuration.md                    # agent.provider section + compatibility note
docs/README.md                                    # link/mention multi-provider support (if index lists features)
examples/WORKFLOW.openai.md                       # new: OpenAI provider example
```
