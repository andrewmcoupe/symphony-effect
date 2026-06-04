# 027: Git Provider Abstraction Layer

## Summary
Define a `GitProvider` abstraction (interface, domain types, errors, config) for opening pull requests, abstracting over hosting providers (GitHub first; future: GitLab, Bitbucket). Symphony opens a PR for the issue's work branch; Linear's own GitHub integration is what moves the ticket to **In Review** (Symphony does **not** transition the tracker itself).

## Dependencies
- 001-project-setup
- 002-config-schema
- 004-tracker-abstraction (reuses the `Issue` domain model)

## Background / Why

The end user configures Linear's native GitHub integration with an automation
like "move issue to In Review when a linked PR is opened". Linear links a PR to
an issue when the PR's **head branch** or **title/body** references the issue
identifier (e.g. `symphony/ABC-123`, or "ABC-123" in the body). Symphony's only
responsibility is therefore to **open a PR that references the issue** — the
transition happens on Linear's side. This task defines the abstraction; GitHub
implementation is task 028 and orchestrator wiring is task 029.

## Acceptance Criteria

- [x] `PullRequestRef` domain model defined:
  ```typescript
  interface PullRequestRef {
    number: number
    url: string
    state: "open" | "closed" | "merged"
    isDraft: boolean
    headBranch: string
  }
  ```
- [x] `OpenPullRequestParams` type defined:
  ```typescript
  interface OpenPullRequestParams {
    issue: Issue          // for templating + identifier reference
    headBranch: string    // the work branch the hooks pushed
    baseBranch: string
    title: string
    body: string
    draft: boolean
  }
  ```
- [x] `GitProvider` service interface (Context tag `symphony/GitProvider`):
  ```typescript
  interface GitProvider {
    // Idempotent lookup: open PR for the head branch, or null
    findOpenPullRequest(headBranch: string): Effect<PullRequestRef | null, GitProviderError>
    // Find-or-create. Returns existing open PR if one exists for the branch.
    // Returns null (benign) when there is nothing to open a PR for
    // (branch missing on remote / no commits between base and head).
    ensurePullRequest(params: OpenPullRequestParams): Effect<PullRequestRef | null, GitProviderError>
  }
  ```
- [x] `GitProviderError` union type (mirrors `TrackerError` style, `Data.TaggedError`):
  - `GitProviderError.UnsupportedKind`
  - `GitProviderError.MissingToken`
  - `GitProviderError.MissingRepository`
  - `GitProviderError.RequestFailed`   — transport failure
  - `GitProviderError.ApiError`        — non-2xx provider response (with status)
  - `GitProviderError.UnknownPayload`  — unexpected response shape
- [x] Config schema: new **optional** `git` section in `WorkflowConfig` (Effect Schema):
  ```yaml
  git:
    kind: github                              # only "github" supported currently
    token: $GITHUB_TOKEN                      # $VAR-resolved (EnvString)
    repo: owner/name                          # target repository
    api_base_url: https://api.github.com      # optional; for GitHub Enterprise
    base_branch: main                         # default: main
    branch_template: "symphony/{{ issue.identifier }}"  # MUST match the hooks' work branch
    draft: false                              # open as draft PR (default: false)
    title_template: "{{ issue.identifier }}: {{ issue.title }}"   # optional
    body_template: |                          # optional; default references the issue
      Automated changes for {{ issue.identifier }}.

      {{ issue.url }}
  ```
  - The whole `git` section is optional. When absent, PR creation is disabled.
- [x] A `NoopGitProvider` (used when `git` config is absent): `findOpenPullRequest`
      and `ensurePullRequest` both succeed with `null`.
- [x] Effect Schema for `PullRequestRef` (for API/observability if needed)

## Technical Notes

- This task defines the interface, errors, config, and the no-op only — the
  GitHub HTTP implementation is task 028.
- Keep the interface minimal: only what the orchestrator needs to open/look up a PR.
- `branch_template`, `title_template`, `body_template` are LiquidJS templates
  rendered with `{ issue }` via the existing `PromptRenderer` (config/renderer.ts).
  Resolve/validate them at config decode time only as plain strings; rendering
  happens at call time in task 029.
- `branch_template` default (`symphony/{{ issue.identifier }}`) must match the
  branch the `before_run`/`after_run` hooks create and push (see WORKFLOW.md).
- The `git` config is parsed alongside `tracker`/`workspace`/etc. in
  `config/schema.ts`; add unit tests for: valid github config, missing token
  ($VAR unset → `MissingEnvVar`), defaults applied, section omitted (→ undefined).

## Files to Create / Modify

```
packages/symphony/src/git/
├── types.ts            # PullRequestRef, OpenPullRequestParams
├── errors.ts           # GitProviderError union
├── provider.ts         # GitProvider service interface + Context tag
├── noop.ts             # NoopGitProvider (PR creation disabled)
└── index.ts            # Public exports

packages/symphony/src/config/schema.ts   # add optional `git` section + tests
```
