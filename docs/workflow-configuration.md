# Workflow Configuration

The workflow file is the main operator interface. It combines YAML front matter
for machine-readable configuration with a Markdown prompt body for the agent.

See [`WORKFLOW.md`](../WORKFLOW.md) and [`examples`](../examples).

## Loader and Schema

- Loader: [`config/loader.ts`](../packages/symphony/src/config/loader.ts)
- Schema: [`config/schema.ts`](../packages/symphony/src/config/schema.ts)
- Prompt renderer: [`config/renderer.ts`](../packages/symphony/src/config/renderer.ts)

The loader uses `gray-matter` to split front matter from prompt text, parses YAML
with `yaml`, and validates/defaults the result with Effect Schema.

## Environment and Path Expansion

String fields that contain secrets support `$VAR` and `${VAR}` expansion.
`workspace.root` also supports leading `~`.

Missing variables fail fast as config errors. This is intentional: a worker
should not start with missing tracker, git, repository, or MCP credentials.
Provider API keys are checked at startup from the selected `agent.provider`:
Anthropic requires `ANTHROPIC_API_KEY`; OpenAI requires `OPENAI_API_KEY`.

## Main Sections

| Section | Purpose |
| --- | --- |
| `tracker` | Linear endpoint, API key, project slug, active states, terminal states. |
| `polling` | Poll interval in milliseconds. |
| `workspace` | Root directory for per-issue workspaces. |
| `git` | Optional GitHub pull request creation settings. |
| `hooks` | Shell lifecycle hooks around workspace and agent execution. |
| `agent` | Concurrency, model, turn limits, stall timeout, MCP servers, allowed tools. |

## Prompt Body

The Markdown body is rendered with Liquid in strict mode. It receives:

- `issue`: Linear issue fields from [`tracker/types.ts`](../packages/symphony/src/tracker/types.ts)
- `attempt`: `null` on first run, positive retry number on failure retries, `0`
  for continuations

Use this body for the workflow prompt described by the Symphony spec: task
context, engineering rules, verification expectations, and tracker handoff
instructions.

## Hooks

Lifecycle hooks are configured under `hooks` and executed by
[`HookExecutor`](../packages/symphony/src/workspace/hooks.ts).

- `after_create`: runs once after a workspace directory is created.
- `before_run`: runs before every agent attempt.
- `after_run`: best-effort; runs after an agent attempt and logs failures.
- `before_remove`: runs before terminal workspace cleanup.

Hooks receive environment variables such as `ISSUE_IDENTIFIER` and
`WORKSPACE_PATH`. The current reference workflow uses hooks to clone, prepare,
commit, and push repository changes.

## Agent MCP Configuration

`agent.provider` selects the agent backend. Supported values are:

- `anthropic` (default): runs through the Anthropic Claude Agent SDK and
  requires `ANTHROPIC_API_KEY`.
- `openai`: runs through the OpenAI Agents SDK and requires `OPENAI_API_KEY`.

`agent.model` is interpreted in the selected provider's model namespace. For
example, Anthropic workflows use Claude model ids such as
`claude-sonnet-4-6`; OpenAI workflows use OpenAI model ids such as `gpt-5.1`.
Omit `agent.model` to use the selected SDK's default.

`agent.mcp_servers` is passed to the selected agent SDK as MCP server config,
and `agent.allowed_tools` limits which tools the backend exposes. Both fields
apply to Anthropic and OpenAI.

For remote MCP server tool policies, OpenAI treats `always_ask` the same as
`always_deny`. Symphony is non-interactive during a Turn, so there is no
operator approval prompt to answer.

This is how the workflow can make tracker tools, such as Linear MCP, available
to the agent while staying aligned with the prompt-driven handoff model.

Supported MCP server config shapes:

- `stdio`
- `http`
- `sse`

The current workflow uses Linear's hosted HTTP MCP server and injects
`LINEAR_API_KEY` through an Authorization header.

See [`Provider Compatibility`](./provider-compatibility.md) for the current
per-provider validation notes.
