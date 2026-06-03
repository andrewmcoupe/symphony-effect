# 020: Startup Cleanup

## Summary
Implement terminal issue workspace cleanup at startup.

## Dependencies
- 001-project-setup
- 002-config-schema
- 005-linear-client
- 006-workspace-manager
- 007-hook-executor

## Acceptance Criteria

- [ ] On startup, before polling loop:
  1. Fetch issues in terminal states from tracker
  2. List existing workspace directories
  3. For each workspace that matches a terminal issue:
     - Run `before_remove` hook (failure logged, ignored)
     - Remove workspace directory
     - Log cleanup action
- [ ] Workspace matching:
  - Directory name matches sanitized issue identifier
  - Directory exists under workspace root
- [ ] Cleanup errors don't block startup
- [ ] Log summary of cleaned workspaces
- [ ] Integration test

## Technical Notes

- Terminal states from config: `tracker.terminal_states`
- Use `tracker.fetchIssuesByStates(terminal_states)` to get terminal issues
- List directories in workspace root
- Match directory names to terminal issue identifiers
- This prevents stale workspaces from accumulating

## Files to Modify

```
packages/symphony/src/
├── main.ts            # Call cleanup before polling
├── orchestrator/
│   └── startup.ts     # Startup cleanup logic (new file)
└── workspace/
    └── manager.ts     # Use existing removeWorkspace
```

## Startup Cleanup Flow

```
Startup
   │
   ▼
Fetch terminal issues from tracker
   │
   ▼
List workspace directories
   │
   ▼
For each directory:
   │
   ├─ Does it match a terminal issue?
   │   │
   │   └─ Yes:
   │       ├─ Run before_remove hook
   │       ├─ Remove directory
   │       └─ Log "Cleaned workspace: ABC-123"
   │
   └─ No: Skip

   │
   ▼
Log "Startup cleanup complete: removed N workspaces"
   │
   ▼
Start polling loop
```

## Startup Logging

```
[INFO] Starting cleanup of stale workspaces...
[INFO] Found 5 terminal issues
[INFO] Found 3 workspace directories
[INFO] Cleaning workspace: ABC-100 (issue state: Done)
[INFO] Cleaning workspace: ABC-101 (issue state: Cancelled)
[INFO] Startup cleanup complete: removed 2 workspaces
```
