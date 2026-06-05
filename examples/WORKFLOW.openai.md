---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states: [Todo]
  terminal_states: [Done]

workspace:
  root: ~/symphony-workspaces

agent:
  provider: openai
  model: gpt-5.1
  max_turns: 15
  allowed_tools:
    - mcp__linear__*
  mcp_servers:
    linear:
      type: http
      url: https://mcp.linear.app/mcp
      headers:
        Authorization: "Bearer $LINEAR_API_KEY"
      alwaysLoad: true
---

You are working on {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

Use the available Linear MCP tools when they are present. Make the necessary
changes to complete this task, follow the existing code patterns, run the
relevant checks, and summarize what changed.

