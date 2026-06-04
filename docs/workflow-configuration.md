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

`agent.mcp_servers` is passed to the Claude Agent SDK as `mcpServers`.
`agent.allowed_tools` is passed as `allowedTools`.

This is how the workflow can make tracker tools, such as Linear MCP, available
to the agent while staying aligned with the prompt-driven handoff model.

Supported MCP server config shapes:

- `stdio`
- `http`
- `sse`

The current workflow uses Linear's hosted HTTP MCP server and injects
`LINEAR_API_KEY` through an Authorization header.

