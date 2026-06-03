# 024: Dashboard Issue Detail Page

## Summary
Build the issue detail page showing specific issue status and history.

## Dependencies
- 021-dashboard-setup
- 022-dashboard-api-hooks

## Acceptance Criteria

- [ ] Issue detail route at `/issues/:identifier`
- [ ] **Issue Header:**
  - Identifier (e.g., "ABC-123")
  - Current status badge (Running/Retrying/Idle)
  - Link to issue in Linear (external link)
- [ ] **Status Section (if Running):**
  - Current turn count
  - Started timestamp
  - Elapsed time (live updating)
  - Current state from tracker
- [ ] **Status Section (if Retrying):**
  - Attempt number
  - Due time countdown
  - Error message (full text)
  - Time until next retry
- [ ] **Status Section (if Idle):**
  - "Not currently being processed"
  - Last known state (if available)
- [ ] **Back Navigation:**
  - Link back to overview
  - Breadcrumb: "Dashboard > ABC-123"
- [ ] Loading state while fetching
- [ ] 404 state if issue not found
- [ ] Auto-refresh every 5 seconds

## Technical Notes

- Use TanStack Router params: `Route.useParams()`
- Use `useIssueDetail(identifier)` hook
- Linear URL format: `https://linear.app/team/issue/{identifier}`
- External link should open in new tab

## Files to Create

```
packages/dashboard/src/
├── routes/
│   └── issues/
│       └── $identifier.tsx    # Issue detail page
├── components/
│   ├── IssueHeader.tsx        # Header with identifier + badge
│   ├── RunningStatus.tsx      # Running state display
│   ├── RetryingStatus.tsx     # Retry state display
│   └── IdleStatus.tsx         # Idle state display
```

## Layout

```
┌─────────────────────────────────────────────────┐
│  ← Dashboard                                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  ABC-123                    [Running] 🔗 Linear │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  Status: Running                                │
│  ┌─────────────────────────────────────────┐   │
│  │ Turn Count:    3                        │   │
│  │ Started:       2024-01-15 14:30:00      │   │
│  │ Elapsed:       5m 30s                   │   │
│  │ Tracker State: In Progress              │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Retrying Layout

```
┌─────────────────────────────────────────────────┐
│  ← Dashboard                                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  GHI-789                   [Retrying] 🔗 Linear │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  Status: Waiting for Retry                      │
│  ┌─────────────────────────────────────────┐   │
│  │ Attempt:       2 of ∞                   │   │
│  │ Next Retry:    1m 45s                   │   │
│  │ Error:                                  │   │
│  │ ┌───────────────────────────────────┐   │   │
│  │ │ Agent timed out after 3600000ms   │   │   │
│  │ │ during turn 5. Last activity was  │   │   │
│  │ │ reading file src/index.ts         │   │   │
│  │ └───────────────────────────────────┘   │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```
