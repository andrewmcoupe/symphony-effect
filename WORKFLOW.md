---
# =============================================================================
# Symphony Workflow Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# Issue Tracker Configuration
# -----------------------------------------------------------------------------
tracker:
  kind: linear                              # Only "linear" is supported currently.
  endpoint: https://api.linear.app/graphql  # Optional. This is the default.
  api_key: $LINEAR_API_KEY                  # Resolved from the environment.
  project_slug: orca-f5530c05d23d               # Linear project slugId to poll.
  active_states:                            # Issues in these states can be run.
    - Todo
    - In Progress
  terminal_states:                          # Issues in these states are cleaned up.
    - Done
    - Cancelled
    - Duplicate

# -----------------------------------------------------------------------------
# Polling Configuration
# -----------------------------------------------------------------------------
polling:
  interval_ms: 30000                        # Re-read this file and poll every 30s.

# -----------------------------------------------------------------------------
# Workspace Configuration
# -----------------------------------------------------------------------------
workspace:
  root: ~/symphony-workspaces               # Base directory for per-issue workspaces.

# -----------------------------------------------------------------------------
# Lifecycle Hooks
# -----------------------------------------------------------------------------
hooks:
  timeout_ms: 120000                        # Two minute timeout for each hook.

  # Runs once when the workspace directory is first created.
  after_create: |
    set -eu
    : "${SYMPHONY_REPOSITORY_URL:?Set SYMPHONY_REPOSITORY_URL to the repository URL}"

    echo "Creating workspace for ${ISSUE_IDENTIFIER} at ${WORKSPACE_PATH}"
    git clone "${SYMPHONY_REPOSITORY_URL}" .
    pnpm install

  # Runs before each agent session. A non-zero exit aborts this attempt.
  before_run: |
    set -eu

    BASE_BRANCH="${SYMPHONY_BASE_BRANCH:-main}"
    WORK_BRANCH="symphony/${ISSUE_IDENTIFIER}"

    echo "Preparing ${WORK_BRANCH} from origin/${BASE_BRANCH}"
    git fetch origin "${BASE_BRANCH}" --prune
    git checkout -B "${WORK_BRANCH}" "origin/${BASE_BRANCH}"
    pnpm install

  # Runs after each agent session. Failures are logged and ignored by Symphony.
  after_run: |
    set -eu

    WORK_BRANCH="symphony/${ISSUE_IDENTIFIER}"

    echo "Saving changes for ${ISSUE_IDENTIFIER}"
    git add -A
    if git diff --cached --quiet; then
      echo "No changes to commit"
      exit 0
    fi

    git commit -m "Symphony: ${ISSUE_IDENTIFIER} automated changes"
    git push -u origin "${WORK_BRANCH}"

  # Runs before a workspace is removed for a terminal issue.
  before_remove: |
    set -eu
    echo "Cleaning up workspace for ${ISSUE_IDENTIFIER} at ${WORKSPACE_PATH}"

# -----------------------------------------------------------------------------
# Agent Configuration
# -----------------------------------------------------------------------------
agent:
  max_concurrent_agents: 5                  # Max parallel agent sessions.
  max_turns: 15                             # Max Claude Code turns per session.
  stall_timeout_ms: 300000                  # Abort if the agent stalls for 5 minutes.
  max_retry_backoff_ms: 300000              # Cap retry backoff at 5 minutes.
  max_concurrent_agents_by_state:           # Optional per-state concurrency limits.
    Todo: 3
    In Progress: 5

---

# Symphony Agent Prompt

You are an autonomous coding agent working on a software engineering task.

## Issue Information

- **ID:** {{ issue.id }}
- **Identifier:** {{ issue.identifier }}
- **Title:** {{ issue.title }}
- **Priority:** {{ issue.priority | default: "Not set" }}
- **State:** {{ issue.state }}
- **Branch:** {{ issue.branchName }}
- **URL:** {{ issue.url }}
- **Created:** {{ issue.createdAt }}
- **Updated:** {{ issue.updatedAt }}
- **Labels:** {% if issue.labels.size > 0 %}{{ issue.labels | join: ", " }}{% else %}None{% endif %}

## Description

{{ issue.description }}

{% if issue.labels.size > 0 %}
## Label Guidance

Use the labels to guide scope and verification:
{% for label in issue.labels %}
- `{{ label }}`{% if label == "bug" %}: prioritize reproducing the failure and adding a regression test.{% endif %}{% if label == "frontend" %}: verify responsive layout and interaction states.{% endif %}{% if label == "backend" %}: verify API contracts, error handling, and persistence behavior.{% endif %}
  {% endfor %}
  {% endif %}

{% if issue.blockedBy.size > 0 %}
## Blockers

This issue is blocked by:
{% for blocker in issue.blockedBy %}
- {{ blocker.identifier }} (`{{ blocker.id }}`) is currently in `{{ blocker.state }}`
  {% endfor %}

Review the blockers before making changes. If they make the task impossible,
leave a clear note in your final response instead of forcing unrelated changes.
{% else %}
## Blockers

No blockers are currently recorded for this issue.
{% endif %}

{% if attempt %}
## Retry Information

This is retry attempt {{ attempt }}. A previous attempt failed.

Before changing code, inspect the workspace for partial edits, rerun the most
relevant failing command if possible, and choose a narrower fix if the previous
approach was too broad.
{% else %}
## First Attempt

This is the first attempt for this issue. Start by reading the relevant files and
matching the existing project patterns.
{% endif %}

## Instructions

1. Understand the issue description and acceptance criteria.
2. Explore the repository before editing.
3. Make the smallest coherent change that completes the issue.
4. Add or update focused tests when behavior changes.
5. Run formatting, linting, typechecking, and relevant tests.
6. Summarize changed files, verification commands, and any residual risk.

## Engineering Guidelines

- Follow the repository's existing conventions.
- Keep changes scoped to {{ issue.identifier }}.
- Prefer explicit errors over silent fallbacks.
- Do not leave generated artifacts, debug logging, or unrelated refactors.
- If the issue is ambiguous, make a reasonable assumption and state it clearly.
