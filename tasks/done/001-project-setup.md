# 001: Project Setup

## Summary
Initialize the monorepo structure with pnpm workspaces, TypeScript configuration, and base dependencies.

## Dependencies
None - this is the foundation.

## Acceptance Criteria

- [ ] `pnpm-workspace.yaml` configured with `packages/*`
- [ ] Root `package.json` with workspace scripts (including `lint` and `format` that run across all packages)
- [ ] Root `package.json` dev dependencies:
  - oxlint
  - oxfmt
- [ ] Root `.oxlintrc.json` configured (shared lint config for all packages)
- [ ] Root `.oxfmtrc.json` (or `oxfmt` config) configured (shared format config for all packages)
- [ ] Root scripts wired up:
  - `lint`: `oxlint`
  - `lint:fix`: `oxlint --fix`
  - `format`: `oxfmt --write .`
  - `format:check`: `oxfmt --check .`
- [ ] `pnpm lint` succeeds across all packages
- [ ] `pnpm format:check` succeeds across all packages
- [ ] `packages/symphony/package.json` with dependencies:
  - effect
  - @effect/schema
  - @effect/platform
  - @effect/platform-node
  - @effect/cli
  - yaml
  - gray-matter
  - liquidjs
  - hono
- [ ] `packages/symphony/package.json` with dev dependencies:
  - typescript
  - vitest
  - @effect/vitest
  - @types/node
- [ ] `packages/symphony/tsconfig.json` with strict mode:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
  - `moduleResolution: "bundler"`
  - `module: "ESNext"`
  - `target: "ES2022"`
- [ ] `packages/dashboard/package.json` with dependencies:
  - react
  - react-dom
  - @tanstack/react-query
  - @tanstack/react-router
  - tailwindcss
  - vite
- [ ] `packages/dashboard/tsconfig.json`
- [ ] `packages/dashboard/vite.config.ts`
- [ ] Basic directory structure in `packages/symphony/src/`:
  - `index.ts`
  - `config/`
  - `tracker/`
  - `workspace/`
  - `agent/`
  - `orchestrator/`
  - `observability/`
- [ ] `pnpm install` succeeds
- [ ] `pnpm -F symphony build` succeeds (even if empty)
- [ ] `pnpm -F dashboard dev` starts Vite

## Technical Notes

- Node 22 LTS target
- ESM only (`"type": "module"` in all package.json)
- Use `@effect/platform-node` for Node.js-specific implementations
- Oxlint and oxfmt are configured once at the root and apply across all packages — no per-package lint/format config or tooling (e.g. no ESLint/Prettier)
- Per the project non-negotiables, oxlint is the only linter and oxfmt is the only formatter

## Files to Create

```
symphony-effect/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .oxlintrc.json
├── .oxfmtrc.json
├── packages/
│   ├── symphony/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── config/
│   │       ├── tracker/
│   │       ├── workspace/
│   │       ├── agent/
│   │       ├── orchestrator/
│   │       └── observability/
│   └── dashboard/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       └── src/
│           └── main.tsx
```
