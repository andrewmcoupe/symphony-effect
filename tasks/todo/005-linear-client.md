# 005: Linear GraphQL Client

## Summary
Implement the TrackerClient interface for Linear using their GraphQL API.

## Dependencies
- 001-project-setup
- 002-config-schema
- 004-tracker-abstraction

## Acceptance Criteria

- [ ] `LinearClient` implements `TrackerClient` interface
- [ ] `fetchCandidateIssues()`:
  - Queries issues in `active_states` for configured `project_slug`
  - Paginates (50 per page)
  - Normalizes to `Issue` domain model
  - Sorts by priority (ascending), then createdAt (oldest first)
- [ ] `fetchIssuesByStates(states)`:
  - Queries issues in specified states
  - Used for terminal cleanup
- [ ] `fetchIssueStatesByIds(ids)`:
  - Fetches only the current state for given issue IDs
  - Returns `Map<issueId, stateName>`
  - Used for reconciliation
- [ ] Blocker extraction:
  - Derive `blockedBy` from inverse `blocks` relations
  - Include id, identifier, and state of blockers
- [ ] Label normalization (lowercase)
- [ ] Priority handling (integer or null)
- [ ] Timestamp parsing (ISO-8601)
- [ ] Error mapping to `TrackerError` variants
- [ ] `LinearClientLive` layer depending on `ConfigLoader`
- [ ] Unit tests with mocked GraphQL responses:
  - Successful fetch
  - Pagination handling
  - Blocker extraction
  - Error scenarios (auth, network, GraphQL errors)

## Technical Notes

- Use `fetch` for HTTP requests
- Authorization header: `Authorization: ${api_key}`
- Endpoint default: `https://api.linear.app/graphql`
- Project filter: `project: { slugId: { eq: $projectSlug } }`
- State names are case-sensitive in Linear, normalize for comparison

## GraphQL Queries

```graphql
# Candidate issues
query CandidateIssues($projectSlug: String!, $states: [String!]!, $cursor: String) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $states } }
    }
    first: 50
    after: $cursor
    orderBy: createdAt
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      branchName
      url
      labels { nodes { name } }
      relations(type: "blocks") {
        nodes {
          relatedIssue { id identifier state { name } }
        }
      }
      createdAt
      updatedAt
    }
  }
}
```

## Files to Create

```
packages/symphony/src/tracker/
├── types.ts           # (from 004)
├── errors.ts          # (from 004)
├── client.ts          # (from 004)
├── linear/
│   ├── client.ts      # LinearClient implementation
│   ├── queries.ts     # GraphQL query strings
│   ├── mapper.ts      # Response to Issue mapping
│   └── client.test.ts # Unit tests
└── index.ts           # Export LinearClient
```
