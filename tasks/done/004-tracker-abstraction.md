# 004: Tracker Abstraction Layer

## Summary
Define the tracker interface and issue domain model that abstracts over issue trackers (Linear, future: GitHub).

## Dependencies
- 001-project-setup

## Acceptance Criteria

- [x] `Issue` domain model defined:
  ```typescript
  interface Issue {
    id: string
    identifier: string      // e.g., "ABC-123"
    title: string
    description: string
    priority: number | null
    state: string           // normalized case
    branchName: string
    url: string
    labels: string[]        // lowercase
    blockedBy: BlockerRef[]
    createdAt: Date
    updatedAt: Date
  }
  ```
- [x] `BlockerRef` type defined:
  ```typescript
  interface BlockerRef {
    id: string
    identifier: string
    state: string
  }
  ```
- [x] `TrackerClient` service interface:
  ```typescript
  interface TrackerClient {
    fetchCandidateIssues(): Effect<Issue[], TrackerError>
    fetchIssuesByStates(states: string[]): Effect<Issue[], TrackerError>
    fetchIssueStatesByIds(ids: string[]): Effect<Map<string, string>, TrackerError>
  }
  ```
- [x] `TrackerError` union type:
  - `TrackerError.UnsupportedKind`
  - `TrackerError.MissingApiKey`
  - `TrackerError.MissingProjectSlug`
  - `TrackerError.RequestFailed`
  - `TrackerError.ApiError`
  - `TrackerError.UnknownPayload`
- [x] Effect Schema for `Issue` (for API responses)

## Technical Notes

- This task defines only the interface, not the implementation
- Linear implementation comes in task 005
- Keep the interface minimal - only methods needed by orchestrator
- `fetchCandidateIssues` returns issues in active states for the configured project
- `fetchIssuesByStates` is used for terminal cleanup at startup
- `fetchIssueStatesByIds` is used for reconciliation

## Files to Create

```
packages/symphony/src/tracker/
├── types.ts           # Issue, BlockerRef types
├── errors.ts          # TrackerError union
├── client.ts          # TrackerClient service interface
└── index.ts           # Public exports
```
