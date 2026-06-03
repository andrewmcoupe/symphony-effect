---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states: [Todo]
  terminal_states: [Done]

workspace:
  root: ~/symphony-workspaces
---

You are working on {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

Make the necessary changes to complete this task. Follow the existing code
patterns, run the relevant checks, and summarize what changed.
