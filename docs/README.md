# Symphony Effect Codebase Guide

This directory is a human-oriented map of the Symphony Effect implementation.
It is organized by Symphony-spec subject area rather than by source directory,
so a reader can start from a concept and find the code that implements it.

The upstream Symphony spec describes a long-running orchestrator that polls a
tracker, claims work, prepares an isolated workspace, runs an agent, records
state, retries failures, and cleans up terminal work. This repo implements that
shape in TypeScript with Effect, Linear, GitHub pull requests, and the Claude
Agent SDK.

## Start Here

- [Spec Implementation Map](./spec-implementation-map.md): how the major spec
  concepts map to this codebase, including deliberate deviations.
- [Runtime Architecture](./runtime-architecture.md): package layout, Effect
  layers, service boundaries, and startup flow.
- [Workflow Configuration](./workflow-configuration.md): `WORKFLOW.md`,
  front matter schema, prompt rendering, hooks, git, and MCP agent settings.
- [Worker Lifecycle](./worker-lifecycle.md): workspace creation, hooks, agent
  turns, PR creation, status handoff, and cleanup.
- [State, Retries, and Concurrency](./state-retries-concurrency.md): in-memory
  orchestrator state, retry queue semantics, stalled worker detection, and
  concurrency limits.
- [Trackers, Git, and Integrations](./trackers-git-integrations.md): Linear,
  GitHub pull requests, lifecycle hooks, and where future providers fit.
- [Observability and Dashboard](./observability-dashboard.md): HTTP API,
  dashboard data model, token metrics, and current limitations.
- [Operations and Deployment](./operations-deployment.md): running locally,
  running one project per process, deployment shape, secrets, and safety notes.

## Important Code Paths

- Core package: [`packages/symphony/src`](../packages/symphony/src)
- Dashboard package: [`packages/dashboard/src`](../packages/dashboard/src)
- Example workflows: [`examples`](../examples)
- Current local workflow: [`WORKFLOW.md`](../WORKFLOW.md)
- Product requirements: [`PRD.md`](../PRD.md)
- Completed implementation tasks: [`tasks/done`](../tasks/done)

## Reading Order

For a new maintainer, read in this order:

1. [Spec Implementation Map](./spec-implementation-map.md)
2. [Runtime Architecture](./runtime-architecture.md)
3. [Workflow Configuration](./workflow-configuration.md)
4. [Worker Lifecycle](./worker-lifecycle.md)
5. [State, Retries, and Concurrency](./state-retries-concurrency.md)

Then branch out into integrations, observability, or operations depending on
the change you need to make.

