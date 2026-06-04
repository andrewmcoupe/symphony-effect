# 029: Open Pull Request on Worker Completion

## Summary
Wire the `GitProvider` into the orchestrator so that when a worker session ends
having pushed work, Symphony opens (or reuses) a PR for the issue's branch. The
PR references the Linear issue, so the user's Linear↔GitHub integration moves the
ticket to **In Review**. Symphony itself performs **no** tracker mutation.

## Dependencies
- 014-worker-execution
- 015-polling-loop
- 027-git-provider-abstraction
- 028-github-pull-request-client

## How It Fits The Existing Flow

- The `after_run` hook already commits and **pushes** the work branch
  (`symphony/$ISSUE_IDENTIFIER`). `after_run` runs inside `runWorker` and
  completes *before* the orchestrator's `handleResult` sees the result, so by the
  time we open a PR the branch is already on the remote.
- `orchestrator.ts` `handleResult` (around line 179) currently maps
  `Completed` / `MaxTurnsReached` → `retry.scheduleContinuation`, `Failed` →
  retry, `IssueNoLongerActive` → release.
- Opening a PR for an issue still in an `active_state` triggers Linear's
  integration to move it to **In Review**. Because **In Review is not in
  `active_states`**, the existing state check (`worker.ts` `fetchIssueState` →
  `IssueNoLongerActive`) and reconciliation naturally stop further processing on
  the next turn/poll. No new "done" state is needed in Symphony.

## Acceptance Criteria

- [x] `GitProvider` added to the orchestrator's dependencies and layer graph
      (`layers.ts`), provided via `GitProviderLive` (GitHub or no-op per config).
- [x] On worker results `Completed` and `MaxTurnsReached`, **before** scheduling
      the continuation, the orchestrator calls `gitProvider.ensurePullRequest`:
  - head branch = `git.branch_template` rendered with `{ issue }`
    (default `symphony/{{ issue.identifier }}`)
  - base branch = `git.base_branch`
  - title = `git.title_template` rendered (default `"{{ issue.identifier }}: {{ issue.title }}"`)
  - body = `git.body_template` rendered (default references `{{ issue.identifier }}` + `{{ issue.url }}`)
  - draft = `git.draft`
- [x] Idempotent: repeated sessions/turns for the same issue do not open duplicate
      PRs (relies on `ensurePullRequest` find-or-create from task 028).
- [x] Benign no-op when nothing was pushed: `ensurePullRequest` returning `null`
      (no commits / branch missing) is logged at info, not treated as a failure.
- [x] PR creation never fails the worker/dispatch: a `GitProviderError` is caught
      and logged as a warning (same posture as `after_run`/`after_remove` hook
      failures), then the continuation proceeds.
- [x] No-op provider path: when `git` config is absent, behavior is unchanged
      (no PR calls, no errors).
- [x] Structured log on PR open: `issue_identifier`, PR `number`, PR `url`.
- [x] Tests:
  - integration-style: a completed worker with a configured (mocked) GitProvider
    opens exactly one PR; a second completion reuses it (no duplicate)
  - `null` (no commits) path logs and continues, no PR
  - `GitProviderError` is swallowed (worker result still handled)
  - `git` absent → no PR interaction
  - Add a `GitProvider` mock under `__tests__/mocks/` mirroring the tracker mock

## Technical Notes

- Render templates with the existing `PromptRenderer` (LiquidJS, strict). Validate
  there is exactly one head branch per issue and that it matches what the hooks push.
- Keep PR creation in the orchestrator (not the worker) so it sits alongside
  `handleResult` and after `after_run` has pushed; this also keeps `Worker`
  free of `GitProvider` deps.
- Consider gating to "only when at least one turn succeeded" to avoid PR attempts
  for issues that failed before pushing (failures already route to retry, not here).

## Files to Create / Modify

```
packages/symphony/src/orchestrator/orchestrator.ts   # inject GitProvider, call in handleResult
packages/symphony/src/layers.ts                      # add GitProviderLive to the graph
packages/symphony/src/__tests__/mocks/git.ts         # GitProvider test double
packages/symphony/src/__tests__/integration/pull-request.test.ts  # new coverage
```

## Docs / Example Updates

- [x] Update `examples/WORKFLOW.md` (and the repo-root `WORKFLOW.md`) with a
      documented `git` section and a note that the **head branch in
      `branch_template` must match the branch the hooks push**.
- [x] Document the **user-side setup** required for the transition:
  - Enable Linear's GitHub integration for the repo
  - Add a Linear automation: "When a linked pull request is opened → move issue to In Review"
  - Linear links the PR via the branch name / identifier in the PR body
- [x] Note that **`In Review` must NOT be added to `active_states`** (otherwise
      Symphony keeps re-running the issue) and need not be terminal.
- [x] Mention `GITHUB_TOKEN` scopes: `repo` (classic) or `pull_requests: write` +
      `contents: read` (fine-grained), for the target repository.
```
