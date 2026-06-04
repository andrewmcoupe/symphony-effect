# Symphony Workflow Examples

This folder contains starter `WORKFLOW.md` files for different levels of setup.
Copy one of these files to your project root as `WORKFLOW.md`, then adjust the
repository URL, Linear project slug, states, and workspace paths.

## Files

- `WORKFLOW.md` is the full reference example. It documents every supported
  configuration section and shows realistic lifecycle hooks for cloning,
  preparing, committing, and pushing work.
- `WORKFLOW.minimal.md` is the smallest practical Linear-backed workflow. It
  relies on defaults for polling, hooks, and agent limits.
- `WORKFLOW.local.md` is for local development without the Linear service or a
  remote repository. It points at a loopback GraphQL endpoint so you can run the
  orchestrator against a local Linear-shaped stub, and its hooks copy from a
  local source checkout instead of cloning or pushing.

## Required Environment Variables

The examples use environment variable references in YAML. Symphony resolves
these while loading the workflow and fails fast if any referenced variable is
missing.

- `LINEAR_API_KEY`: Linear API token for the full and minimal examples.
- `ANTHROPIC_API_KEY`: Anthropic API key used by the Claude Agent SDK.
- `GITHUB_TOKEN`: GitHub token for the full example's `git` provider. Needs repo
  scope (classic) or `pull_requests:write` + `contents:read`.
- `SYMPHONY_REPOSITORY_URL`: Git URL cloned by the full example.
- `SYMPHONY_BASE_BRANCH`: Optional base branch for full example hooks. Defaults
  to `main`.
- `SYMPHONY_LOCAL_SOURCE`: Absolute path to a local source repository for the
  local example.
- `SYMPHONY_LOCAL_API_KEY`: Any non-empty token accepted by your local stub.

## Prompt Variables

Prompt templates are rendered with Liquid in strict mode. Use the implemented
camelCase issue fields:

- `issue.id`
- `issue.identifier`
- `issue.title`
- `issue.description`
- `issue.priority`
- `issue.state`
- `issue.branchName`
- `issue.url`
- `issue.labels`
- `issue.blockedBy`
- `issue.createdAt`
- `issue.updatedAt`
- `attempt`

`attempt` is `null` for the first run and a number for retry runs.

## Local Workflow Notes

`WORKFLOW.local.md` avoids real Linear by setting the tracker endpoint to
`http://127.0.0.1:4010/graphql`. Start a local GraphQL stub on that address that
returns Linear-compatible issue data before running Symphony with that file.

Example:

```sh
export SYMPHONY_LOCAL_API_KEY=local-dev-token
export ANTHROPIC_API_KEY=sk-ant-...
export SYMPHONY_LOCAL_SOURCE="$HOME/src/my-project"
pnpm --filter symphony build
pnpm --filter symphony exec symphony examples/WORKFLOW.local.md --port 7331
```
