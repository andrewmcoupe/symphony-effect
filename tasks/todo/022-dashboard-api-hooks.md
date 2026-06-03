# 022: Dashboard API Hooks

## Summary
Create TanStack Query hooks for fetching orchestrator state.

## Dependencies
- 021-dashboard-setup
- 017-http-api

## Acceptance Criteria

- [ ] API client module with typed fetch functions:
  - `fetchState(): Promise<StateSnapshot>`
  - `fetchIssue(identifier: string): Promise<IssueDetail>`
  - `triggerRefresh(): Promise<void>`
- [ ] TanStack Query hooks:
  - `useOrchestratorState()` - polls every 5 seconds
  - `useIssueDetail(identifier: string)` - polls every 5 seconds
  - `useRefreshMutation()` - triggers manual refresh
- [ ] TypeScript types matching API responses:
  - `StateSnapshot`
  - `IssueDetail`
  - `RunningIssue`
  - `RetryEntry`
  - `TokenTotals`
- [ ] Error handling:
  - Network errors surface in query state
  - Loading states available
- [ ] Optimistic updates for refresh mutation
- [ ] Unit tests for hooks (using msw or similar)

## Technical Notes

- Use `fetch` for API calls
- TanStack Query handles caching and deduplication
- `refetchInterval: 5000` for auto-polling
- Types should mirror `packages/symphony/src/observability/types.ts`

## Files to Create

```
packages/dashboard/src/
├── api/
│   ├── client.ts      # Fetch functions
│   └── types.ts       # API response types
├── hooks/
│   ├── useOrchestratorState.ts
│   ├── useIssueDetail.ts
│   ├── useRefreshMutation.ts
│   └── index.ts
└── hooks/
    └── hooks.test.ts  # Hook tests
```

## Hook Usage

```typescript
function Overview() {
  const { data, isLoading, error } = useOrchestratorState()
  const refresh = useRefreshMutation()

  if (isLoading) return <Spinner />
  if (error) return <Error message={error.message} />

  return (
    <div>
      <Button onClick={() => refresh.mutate()}>Refresh</Button>
      <RunningList issues={data.running} />
      <RetryQueue entries={data.retrying} />
    </div>
  )
}
```

## API Types

```typescript
interface StateSnapshot {
  running: RunningIssue[]
  retrying: RetryEntry[]
  tokenTotals: TokenTotals
  config: {
    pollingIntervalMs: number
    maxConcurrentAgents: number
  }
  lastPollAt: string | null
}

interface RunningIssue {
  issueId: string
  identifier: string
  turnCount: number
  startedAt: string
  elapsedMs: number
  state: string
}

interface RetryEntry {
  issueId: string
  identifier: string
  attempt: number
  dueAt: string
  error: string
}

interface TokenTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  runtimeSeconds: number
}
```
