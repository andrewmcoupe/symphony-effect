# Provider Compatibility

Symphony selects exactly one agent Provider per workflow through
`agent.provider`. The orchestrator and worker remain Provider-agnostic after the
`AgentRunner` layer is constructed.

## Anthropic

- Backend: Anthropic Claude Agent SDK.
- Auth: requires `ANTHROPIC_API_KEY` when `agent.provider` is omitted or set to
  `anthropic`.
- Model namespace: Anthropic model ids, for example `claude-sonnet-4-6`.
- MCP tools: `agent.mcp_servers` and `agent.allowed_tools` are passed to the
  Claude Agent SDK.
- Continuation: `TurnResult.sessionId` carries the Claude session id, and the
  next Turn passes it as `resume`.
- Token reporting: Claude SDK result usage maps to `TokenUsage`, including
  cache creation/read tokens and total cost when provided by the SDK.
- Validation: covered by unit and integration tests for successful Turns,
  continuation, error mapping, MCP config, token totals, and worker recording.

## OpenAI

- Backend: OpenAI Agents SDK.
- Auth: requires `OPENAI_API_KEY` when `agent.provider` is `openai`.
- Model namespace: OpenAI model ids, for example `gpt-5.1`.
- Workspace access: runs as an OpenAI Sandbox Agent with Symphony's per-Issue
  workspace mounted at `/workspace/repo`, so filesystem and shell tool changes
  are made in the existing workspace.
- MCP tools: `agent.mcp_servers` and `agent.allowed_tools` are adapted to the
  OpenAI Agents SDK MCP server API. Configured MCP servers connect strictly; a
  failed server fails the Turn instead of being silently omitted. Before the
  model runs, Symphony verifies that the configured MCP servers expose at least
  one visible tool and adds the visible tool names to the OpenAI agent
  instructions.
- Tool policy: `always_ask` is treated as deny, matching `always_deny`, because
  Symphony runs non-interactively and has no operator approval prompt during a
  Turn.
- Continuation: `TurnResult.sessionId` carries the OpenAI response id, and the
  next Turn passes it as `previousResponseId`.
- Token reporting: OpenAI SDK usage maps to `TokenUsage` when usage is present
  on the run state or serialized as snake_case fields. Cost is recorded when the
  SDK reports it.
- Validation: unit tests cover successful Turns, MCP server wiring, tool
  filtering, continuation id mapping, token usage mapping, timeout, interruption,
  and SDK error mapping.

## Live Validation

The live OpenAI end-to-end check for Q1 has not been run in this environment:
`OPENAI_API_KEY` is unset. Before treating OpenAI as production-validated, run a
real Issue with `agent.provider: openai` and confirm:

- the MCP tool loop works across multiple Turns,
- `TurnRecorded` Agent Output is populated,
- `TokenTotalsChanged` reflects real usage,
- the response id returned from one Turn resumes the next Turn.
