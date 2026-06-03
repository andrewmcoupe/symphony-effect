# 023: Dashboard Overview Page

## Summary
Build the main dashboard overview showing running agents, retry queue, and token totals.

## Dependencies
- 021-dashboard-setup
- 022-dashboard-api-hooks

## Acceptance Criteria

- [ ] Overview route at `/`
- [ ] **Stats Cards Row:**
  - Running agents count (with max)
  - Retry queue size
  - Total tokens used
  - Runtime seconds
- [ ] **Running Agents Table:**
  - Columns: Identifier, State, Turn Count, Started, Elapsed
  - Identifier links to issue detail page
  - State shown as colored badge
  - Elapsed time updates live (calculated from startedAt)
  - Empty state: "No agents running"
- [ ] **Retry Queue Table:**
  - Columns: Identifier, Attempt, Due In, Error
  - "Due In" shows countdown (e.g., "2m 30s")
  - Error shown truncated with tooltip for full text
  - Empty state: "No retries queued"
- [ ] **Refresh Button:**
  - Triggers `POST /api/v1/refresh`
  - Shows loading state
  - Refetches state after success
- [ ] **Last Poll Timestamp:**
  - Shows when last poll occurred
  - Format: relative time ("30 seconds ago")
- [ ] Responsive layout (works on mobile)
- [ ] Loading skeleton while data fetches
- [ ] Error state with retry button

## Technical Notes

- Use shadcn/ui Card, Table, Badge components
- Use `date-fns` or similar for time formatting
- Elapsed time: `Date.now() - new Date(startedAt).getTime()`
- Due time countdown: `new Date(dueAt).getTime() - Date.now()`
- State badge colors: Todo=blue, "In Progress"=yellow, etc.

## Files to Create

```
packages/dashboard/src/
├── routes/
│   └── index.tsx              # Overview page
├── components/
│   ├── StatsCards.tsx         # Stats row
│   ├── RunningAgentsTable.tsx # Running table
│   ├── RetryQueueTable.tsx    # Retry table
│   ├── StateBadge.tsx         # Colored state badge
│   ├── RelativeTime.tsx       # Time formatting
│   └── Countdown.tsx          # Countdown timer
```

## Layout

```
┌─────────────────────────────────────────────────┐
│  Symphony Dashboard              [Refresh] [⟳]  │
├─────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────┐│
│  │ Running  │ │ Retrying │ │  Tokens  │ │Time ││
│  │   3/10   │ │    2     │ │  45.2K   │ │ 4h  ││
│  └──────────┘ └──────────┘ └──────────┘ └─────┘│
├─────────────────────────────────────────────────┤
│  Running Agents                                 │
│  ┌──────────────────────────────────────────┐  │
│  │ ID      │ State       │ Turns │ Elapsed  │  │
│  │ ABC-123 │ In Progress │   3   │ 5m 30s   │  │
│  │ DEF-456 │ Todo        │   1   │ 2m 15s   │  │
│  └──────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│  Retry Queue                                    │
│  ┌──────────────────────────────────────────┐  │
│  │ ID      │ Attempt │ Due In  │ Error      │  │
│  │ GHI-789 │    2    │ 1m 45s  │ Timed out  │  │
│  └──────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│  Last poll: 30 seconds ago                      │
└─────────────────────────────────────────────────┘
```
