# 028: GitHub Pull Request Client

## Summary
Implement the `GitProvider` interface for GitHub using the REST API and a
`$GITHUB_TOKEN`, mirroring the Linear client's `fetch` + typed-error style.

## Dependencies
- 001-project-setup
- 002-config-schema
- 027-git-provider-abstraction

## Acceptance Criteria

- [x] `GitHubClient` implements `GitProvider`
- [x] `findOpenPullRequest(headBranch)`:
  - `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`
  - Returns the first open PR mapped to `PullRequestRef`, or `null`
- [x] `ensurePullRequest(params)`:
  - First calls `findOpenPullRequest(headBranch)`; if found, return it (idempotent — no duplicate PRs across turns/sessions)
  - Otherwise `POST /repos/{owner}/{repo}/pulls` with `{ title, head, base, body, draft }`
  - Returns the created PR as `PullRequestRef`
  - **Benign skips return `null`** (logged, not errors):
    - 422 "No commits between {base} and {head}" (agent pushed nothing)
    - 404 / head branch not found on remote
  - 422 "A pull request already exists" → re-query and return the existing PR
- [x] Request headers:
  - `Authorization: Bearer ${token}`
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `User-Agent: symphony`
- [x] `repo` parsed as `owner/name`; malformed → `GitProviderError.MissingRepository`
- [x] Honors `api_base_url` (default `https://api.github.com`) for GitHub Enterprise
- [x] Error mapping to `GitProviderError` variants:
  - network/transport → `RequestFailed`
  - non-2xx (auth 401/403, validation) → `ApiError` with status + GitHub message
  - unexpected body shape → `UnknownPayload`
  - empty/missing token → `MissingToken`
- [x] `GitProviderLive` layer depending on `ConfigLoader`:
  - When `git.kind === "github"` → GitHub client
  - When `git` section absent → `NoopGitProvider` (from 027)
  - Unsupported kind → `UnsupportedKind`
- [x] Unit tests with a mocked `fetch` (mirror `linear/client.test.ts`):
  - find returns existing open PR
  - ensure creates a PR when none exists
  - ensure is idempotent when a PR already exists (no second POST)
  - 422 no-commits → returns `null`
  - auth failure (401) → `ApiError`
  - transport error → `RequestFailed`
  - no-op provider when `git` absent

## Technical Notes

- Reuse the patterns in `tracker/linear/client.ts`: inject a `fetch` impl
  (`type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>`),
  a `loadConfig` thunk, `Effect.tryPromise` wrapping, and a `postJson`/`getJson`
  helper analogous to `postGraphql`.
- Provide `makeGitHubClient`, `makeGitHubClientFromConfig`, `makeGitProviderLive`,
  and `GitProviderLive` exports, mirroring the Linear client's factory set.
- GitHub's `head` filter is `{owner}:{branch}` for same-repo branches.
- Map PR `state`: GitHub returns `open`/`closed` plus a `merged_at`; derive
  `"merged"` when `merged_at != null`, else `state`.
- Do not log the token. Errors must not echo the `Authorization` header.

## REST Shapes

```http
# Find open PR for a branch
GET /repos/{owner}/{repo}/pulls?head={owner}:symphony%2FABC-123&state=open

# Create PR
POST /repos/{owner}/{repo}/pulls
{
  "title": "ABC-123: Fix the thing",
  "head": "symphony/ABC-123",
  "base": "main",
  "body": "Automated changes for ABC-123.\n\nhttps://linear.app/...",
  "draft": false
}
```

## Files to Create

```
packages/symphony/src/git/
├── types.ts            # (from 027)
├── errors.ts           # (from 027)
├── provider.ts         # (from 027)
├── noop.ts             # (from 027)
├── github/
│   ├── client.ts       # GitHubClient implementation + GitProviderLive layer
│   ├── mapper.ts       # REST response → PullRequestRef
│   └── client.test.ts  # Unit tests (mocked fetch)
└── index.ts            # Export GitHub client + layer
```
