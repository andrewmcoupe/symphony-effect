# Operations and Deployment

This implementation is easiest to run as one long-running process per project.
That matches the current model: one process loads one `WORKFLOW.md`, one
tracker project, one workspace root, one hook set, and one prompt.

## Local Run

For solo development, local is the simplest deployment:

```sh
export ANTHROPIC_API_KEY=...
# Or, for workflows with `agent.provider: openai`:
# export OPENAI_API_KEY=...
export LINEAR_API_KEY=...
export GITHUB_TOKEN=...
export SYMPHONY_REPOSITORY_URL=git@github.com:owner/repo.git

pnpm build
pnpm --filter symphony exec symphony WORKFLOW.md --port 7331
```

Use `tmux`, `screen`, or a local service manager if you want it to keep running.

## One Project Per Process

For multiple projects, run multiple instances from the same image or checkout:

```text
symphony-project-a -> WORKFLOW.project-a.md -> /var/lib/symphony/project-a
symphony-project-b -> WORKFLOW.project-b.md -> /var/lib/symphony/project-b
```

Keep each instance isolated with its own:

- workflow file,
- workspace root,
- secrets,
- logs,
- concurrency limits.

## Container Shape

A container needs:

- Node 22,
- pnpm 11,
- git and SSH client,
- package managers used by target repos,
- built `packages/symphony`,
- mounted workflow file,
- persistent workspace volume,
- environment secrets.

Avoid scaling a single project horizontally until state and claims are backed by
an external store.

## Secrets

Typical secrets:

- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, depending on `agent.provider`
- `LINEAR_API_KEY`
- `GITHUB_TOKEN`
- `SYMPHONY_REPOSITORY_URL`
- SSH deploy key if cloning or pushing via SSH

Do not commit real tokens into workflow files. Use `$VAR` references.

## Cost Controls

The infra cost is usually much lower than LLM/API usage. Control token spend by:

- keeping `active_states` narrow,
- excluding review states from active states,
- using conservative `agent.max_turns`,
- keeping `agent.max_concurrent_agents` low while testing,
- watching token totals in the dashboard/API,
- avoiding continuation loops.

Claude Code handles prompt caching automatically. The main cache-related
operational concern is preserving stable prompt prefixes and avoiding avoidable
tool/model/MCP changes mid-run.

## Safety Notes

The agent runs in a workspace and hooks run shell commands. Treat Symphony like
a CI runner with write access:

- use a dedicated machine or container,
- scope credentials narrowly,
- prefer repository-specific deploy keys/tokens,
- keep workspace roots away from personal files,
- do not expose the HTTP API publicly without auth.
