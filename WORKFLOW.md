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
# Git Provider Configuration
# -----------------------------------------------------------------------------
# Opens or reuses a GitHub pull request after a worker session pushes changes.
# The head branch must match the branch pushed by the lifecycle hooks below.
# User setup:
# - Enable Linear's GitHub integration for this repository.
# - Add a Linear automation: linked pull request opened -> move issue to In Review.
# - Keep In Review out of active_states so Symphony stops rerunning reviewed work.
# - GITHUB_TOKEN needs repo scope (classic) or pull_requests:write + contents:read.
git:
  kind: github
  token: $GITHUB_TOKEN
  repo: andrewmcoupe/country-playground-app
  base_branch: main
  branch_template: "symphony/{{ issue.identifier }}"
  draft: false
  title_template: "{{ issue.identifier }}: {{ issue.title }}"
  body_template: |
    Automated changes for {{ issue.identifier }}.

    {{ issue.url }}

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

    if [ -f pnpm-lock.yaml ]; then
      pnpm install --frozen-lockfile
    elif [ -f package-lock.json ]; then
      npm ci
    elif [ -f yarn.lock ]; then
      yarn install --frozen-lockfile
    elif [ -f package.json ]; then
      npm install
    fi

    # Keep dependency setup from becoming the first committed agent output.
    git reset --hard

  # Runs before each agent session. A non-zero exit aborts this attempt.
  before_run: |
    set -eu

    BASE_BRANCH="${SYMPHONY_BASE_BRANCH:-main}"
    WORK_BRANCH="symphony/${ISSUE_IDENTIFIER}"

    echo "Preparing ${WORK_BRANCH} from origin/${BASE_BRANCH}"
    git fetch origin "${BASE_BRANCH}" --prune
    git checkout -B "${WORK_BRANCH}" "origin/${BASE_BRANCH}"

    if [ -f pnpm-lock.yaml ]; then
      pnpm install --frozen-lockfile
    elif [ -f package-lock.json ]; then
      npm ci
    elif [ -f yarn.lock ]; then
      yarn install --frozen-lockfile
    elif [ -f package.json ]; then
      npm install
    fi

    # Revert tracked setup noise, such as Corepack/pnpm packageManager metadata.
    git reset --hard

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
    git push --force-with-lease -u origin "${WORK_BRANCH}"

  # Runs before a workspace is removed for a terminal issue.
  before_remove: |
    set -eu
    echo "Cleaning up workspace for ${ISSUE_IDENTIFIER} at ${WORKSPACE_PATH}"

# -----------------------------------------------------------------------------
# Agent Configuration
# -----------------------------------------------------------------------------
agent:
  provider: openai
  model: gpt-5.4
  max_concurrent_agents: 5                  # Max parallel agent sessions.
  max_turns: 25                             # Max agent SDK turns per session.
  stall_timeout_ms: 300000                  # Abort if the agent stalls for 5 minutes.
  max_retry_backoff_ms: 300000              # Cap retry backoff at 5 minutes.
  max_concurrent_agents_by_state:           # Optional per-state concurrency limits.
    Todo: 3
    In Progress: 5
  allowed_tools:                            # Auto-allow tracker tools for handoff.
    - mcp__linear__*
  mcp_servers:                              # Passed to the selected provider's agent SDK.
    linear:
      type: http
      url: https://mcp.linear.app/mcp
      headers:
        Authorization: "Bearer $LINEAR_API_KEY"
      alwaysLoad: true

  # OpenAI provider variant:
  # provider: openai
  # model: gpt-5.1
  # Requires OPENAI_API_KEY instead of ANTHROPIC_API_KEY.

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

1. Update Linear before coding: follow the "Linear Issue Lifecycle" section below
   to move the issue to `In Progress` and make sure its acceptance criteria are
   recorded on the issue.
2. Understand the issue description and acceptance criteria.
3. Explore the repository before editing.
4. Make the smallest coherent change that completes the issue.
5. Add or update focused tests when behavior changes.
6. Run formatting, linting, typechecking, and relevant tests.
7. Keep the acceptance-criteria checklist on the issue up to date as you go.
8. Summarize changed files, verification commands, and any residual risk.

## Linear Issue Lifecycle

Keep Linear issue {{ issue.identifier }} an accurate, living record of this work.
Use the Linear MCP tools for each step below. If Linear tooling is not available,
do not spend turns trying to install or discover it — note that the Linear updates
were skipped because no Linear tooling is available, then continue with the
engineering work. Do not move the issue to `Done`; human review and merge own that
transition.

**At the start of the run:**

1. If {{ issue.identifier }} is not already `In Progress`, move it there.
2. Ensure the issue description has an `## Acceptance Criteria` section containing a
   markdown checklist (`- [ ]` items). If that section already exists — written by a
   human or an earlier run — leave its wording alone. If it is missing, derive 2–6
   concrete, verifiable criteria from the description and append the section to the
   END of the existing description. Never replace or delete the human-written
   description text.

**While you work:**

- As you satisfy each criterion, edit the description to tick that item
  (`- [ ]` → `- [x]`). A human may tick items at the same time, so re-read the
  current description immediately before each edit and change only the checkbox you
  are completing, preserving every other line exactly.

**When implementation and local verification are complete:**

1. Tick every criterion you have met.
2. Move {{ issue.identifier }} to `In Review`.
3. Add a Linear comment stating implementation is complete and Symphony will open a
   pull request for branch `symphony/{{ issue.identifier }}` after this run.

## Filing Suggestions

While working {{ issue.identifier }} you may notice something that is **out of
scope for this issue** but still worth a human's attention — for example, code
that contradicts a documented workspace convention (`CLAUDE.md`, `CONTEXT.md`, an
ADR), a latent bug or correctness hazard outside this issue, or missing tests or
error handling on a code path you touched. Do **not** fix it here — that would
break scope. Instead, record it as a backlog suggestion using the Linear MCP
tools.

This is a best-effort side-task, never a blocker. If Linear tooling is
unavailable or any step below fails, note it in your summary and move on — the
success of {{ issue.identifier }} never depends on filing a suggestion.

Apply a high bar: file a suggestion only if you would genuinely flag it to a
colleague, and only when you can point to a concrete file and line. Do **not**
file subjective style preferences or speculative "would be nice" refactors. This
is a ceiling, not a quota — most runs file nothing.

When you do find something that clears the bar:

1. **Check for duplicates first.** Search existing issues — especially open ones
   labelled `agent created` — for the same problem. If a match already exists,
   skip filing and move on.
2. **Create the issue** in the same project as {{ issue.identifier }}, in the
   `Backlog` state, with the `agent created` label. Write a concise title stating
   the problem itself (not "while working {{ issue.identifier }} I noticed…").
   In the description, state what you observed, the specific file(s) and line(s),
   and which documented convention it violates if applicable. End the description
   with a provenance line: "Spotted by Symphony while working
   {{ issue.identifier }}."
3. **Comment on {{ issue.identifier }}** noting the identifier of the suggestion
   you filed and a one-line summary of what it covers.

Keep the volume low: if you find yourself filing more than two or three
suggestions in one run, you are losing focus on the actual issue — record the
rest in your final summary instead of filing them.

## Engineering Guidelines

- Follow the repository's existing conventions.
- Keep changes scoped to {{ issue.identifier }}.
- Prefer explicit errors over silent fallbacks.
- Do not leave generated artifacts, debug logging, or unrelated refactors.
- If the issue is ambiguous, make a reasonable assumption and state it clearly.
