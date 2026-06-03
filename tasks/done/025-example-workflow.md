# 025: Example WORKFLOW.md

## Summary
Create a well-documented example WORKFLOW.md file that demonstrates all configuration options.

## Dependencies
- 002-config-schema

## Acceptance Criteria

- [x] `examples/WORKFLOW.md` file created
- [x] All config sections documented with comments
- [x] Realistic hook scripts:
  - `after_create`: git clone + dependency install
  - `before_run`: fetch + checkout branch
  - `after_run`: commit + push changes
  - `before_remove`: (optional cleanup)
- [x] Comprehensive prompt template demonstrating:
  - All issue variables
  - Conditional for retry attempts
  - Label handling
  - Blocker information
- [x] `examples/WORKFLOW.minimal.md` - bare minimum config
- [x] `examples/WORKFLOW.local.md` - for local testing without Linear
- [x] README in examples folder explaining each variant

## Technical Notes

- Hook scripts should be bash-compatible
- Environment variables used: `ISSUE_IDENTIFIER`, `WORKSPACE_PATH`
- Prompt should guide the agent effectively
- Comments in YAML use `#`

## Files to Create

```
examples/
├── README.md
├── WORKFLOW.md           # Full example
├── WORKFLOW.minimal.md   # Minimal config
└── WORKFLOW.local.md     # Local testing
```

## Full Example (WORKFLOW.md)

```yaml
---
# =============================================================================
# Symphony Workflow Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# Issue Tracker Configuration
# -----------------------------------------------------------------------------
tracker:
  kind: linear                              # Only "linear" supported currently
  endpoint: https://api.linear.app/graphql  # Optional, this is the default
  api_key: $LINEAR_API_KEY                  # Environment variable reference
  project_slug: my-project                  # Your Linear project slug
  active_states:                            # Issues in these states are candidates
    - Todo
    - In Progress
  terminal_states:                          # Issues in these states trigger cleanup
    - Done
    - Cancelled
    - Duplicate

# -----------------------------------------------------------------------------
# Polling Configuration
# -----------------------------------------------------------------------------
polling:
  interval_ms: 30000                        # Poll every 30 seconds

# -----------------------------------------------------------------------------
# Workspace Configuration
# -----------------------------------------------------------------------------
workspace:
  root: ~/symphony-workspaces               # Base directory for all workspaces

# -----------------------------------------------------------------------------
# Lifecycle Hooks
# -----------------------------------------------------------------------------
hooks:
  timeout_ms: 120000                        # 2 minute timeout for hooks

  # Runs once when workspace is first created
  after_create: |
    echo "Creating workspace for $ISSUE_IDENTIFIER"
    git clone git@github.com:myorg/myrepo.git .
    pnpm install

  # Runs before each agent session (failure aborts the attempt)
  before_run: |
    echo "Preparing workspace for $ISSUE_IDENTIFIER"
    git fetch origin
    git checkout -B symphony/$ISSUE_IDENTIFIER origin/main
    pnpm install

  # Runs after each agent session (failure is logged but ignored)
  after_run: |
    echo "Saving changes for $ISSUE_IDENTIFIER"
    git add -A
    git commit -m "Symphony: $ISSUE_IDENTIFIER - automated changes" || true
    git push -u origin symphony/$ISSUE_IDENTIFIER || true

  # Runs before workspace removal (failure is logged but ignored)
  before_remove: |
    echo "Cleaning up workspace for $ISSUE_IDENTIFIER"

# -----------------------------------------------------------------------------
# Agent Configuration
# -----------------------------------------------------------------------------
agent:
  max_concurrent_agents: 5                  # Max parallel agent sessions
  max_turns: 15                             # Max turns per session
  max_retry_backoff_ms: 300000              # Max 5 minute backoff
  max_concurrent_agents_by_state:           # Per-state limits (optional)
    Todo: 3
    In Progress: 5

---

# Symphony Agent Prompt

You are an autonomous coding agent working on a software engineering task.

## Issue Information

- **Identifier:** {{ issue.identifier }}
- **Title:** {{ issue.title }}
- **Priority:** {{ issue.priority | default: "Not set" }}
- **State:** {{ issue.state }}
- **Labels:** {{ issue.labels | join: ", " | default: "None" }}

## Description

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
## Blockers

This issue is blocked by:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}

Consider whether these blockers affect your approach.
{% endif %}

## Instructions

1. **Understand** - Read the issue description carefully
2. **Explore** - Find relevant files in the codebase
3. **Plan** - Determine the changes needed
4. **Implement** - Make the necessary code changes
5. **Test** - Ensure your changes work correctly
6. **Verify** - Run any existing tests

{% if attempt %}
## Retry Information

This is **retry attempt {{ attempt }}**. The previous attempt(s) failed.

Please:
- Review what might have gone wrong
- Try a different approach if needed
- Be more careful with edge cases
{% endif %}

## Guidelines

- Follow existing code patterns and conventions
- Write clean, readable code
- Add comments only where logic is non-obvious
- Don't over-engineer - make minimal changes to solve the issue
- If you're unsure about something, make a reasonable decision and note it
```

## Minimal Example (WORKFLOW.minimal.md)

```yaml
---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states: [Todo]
  terminal_states: [Done]

workspace:
  root: ~/workspaces
---

You are working on {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

Make the necessary changes to complete this task.
```
