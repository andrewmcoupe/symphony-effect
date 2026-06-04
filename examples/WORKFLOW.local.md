---
# Local development workflow.
# This keeps all repository operations on your machine and points Symphony at a
# local Linear-compatible GraphQL stub instead of the Linear service.

tracker:
  kind: linear
  endpoint: http://127.0.0.1:4010/graphql   # Local stub, not api.linear.app.
  api_key: $SYMPHONY_LOCAL_API_KEY          # Any token your local stub accepts.
  project_slug: local-project
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled

polling:
  interval_ms: 5000                         # Faster polling for local feedback.

workspace:
  root: /tmp/symphony-local-workspaces      # Disposable local workspaces.

hooks:
  timeout_ms: 60000

  # Copy a local checkout into the per-issue workspace.
  after_create: |
    set -eu
    : "${SYMPHONY_LOCAL_SOURCE:?Set SYMPHONY_LOCAL_SOURCE to a local repository path}"

    echo "Copying ${SYMPHONY_LOCAL_SOURCE} into ${WORKSPACE_PATH}"
    tar -C "${SYMPHONY_LOCAL_SOURCE}" \
      --exclude .git \
      --exclude node_modules \
      --exclude dist \
      -cf - . | tar -C "${WORKSPACE_PATH}" -xf -

    if [ -f package.json ]; then
      pnpm install
    fi

  # Initialize a local branch for each run without contacting a remote.
  before_run: |
    set -eu

    if [ ! -d .git ]; then
      git init
      git add -A
      git commit -m "Local baseline for ${ISSUE_IDENTIFIER}" || true
    fi

    git checkout -B "symphony/${ISSUE_IDENTIFIER}"

  # Keep results in the local workspace for inspection.
  after_run: |
    set -eu

    git add -A
    if git diff --cached --quiet; then
      echo "No local changes to commit"
      exit 0
    fi

    git commit -m "Local Symphony result for ${ISSUE_IDENTIFIER}"
    echo "Review local result in ${WORKSPACE_PATH}"

  # Leave a trace in logs before Symphony removes terminal workspaces.
  before_remove: |
    set -eu
    echo "Removing local workspace ${WORKSPACE_PATH}"

agent:
  max_concurrent_agents: 1
  max_turns: 8
  model: claude-sonnet-4-6
  stall_timeout_ms: 120000
  max_retry_backoff_ms: 30000
  max_concurrent_agents_by_state:
    Todo: 1
    In Progress: 1

---

# Local Symphony Agent Prompt

You are testing Symphony locally with fixture issue data.

## Issue

- **Identifier:** {{ issue.identifier }}
- **Title:** {{ issue.title }}
- **State:** {{ issue.state }}
- **Branch:** {{ issue.branchName }}
- **Labels:** {% if issue.labels.size > 0 %}{{ issue.labels | join: ", " }}{% else %}None{% endif %}

{{ issue.description }}

{% if issue.blockedBy.size > 0 %}
## Local Fixture Blockers

{% for blocker in issue.blockedBy %}
- {{ blocker.identifier }} is in {{ blocker.state }}
{% endfor %}
{% endif %}

{% if attempt %}
This is local retry attempt {{ attempt }}. Inspect the previous local changes
before trying again.
{% endif %}

Make a small, verifiable change, then run the fastest relevant local check.
