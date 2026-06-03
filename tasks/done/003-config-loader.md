# 003: Config Loader Service

## Summary
Implement the Effect service that loads and parses WORKFLOW.md files, extracting front matter and prompt template.

## Dependencies
- 001-project-setup
- 002-config-schema

## Acceptance Criteria

- [x] `ConfigLoader` Effect service defined
- [x] `load(path: string)` method that:
  - Reads file from filesystem
  - Extracts YAML front matter using `gray-matter`
  - Parses YAML using `yaml` package
  - Validates against `WorkflowConfig` schema
  - Returns `{ config: WorkflowConfig, promptTemplate: string }`
- [x] Typed errors:
  - `ConfigError.FileNotFound`
  - `ConfigError.ParseFailed` (YAML syntax error)
  - `ConfigError.ValidationFailed` (schema validation)
  - `ConfigError.MissingEnvVar`
- [x] `ConfigLoaderLive` layer using `@effect/platform` FileSystem
- [x] Unit tests with mock filesystem:
  - Successful load
  - File not found
  - Invalid YAML
  - Invalid config (schema validation)
  - Missing env var

## Technical Notes

- Use `@effect/platform/FileSystem` for file reading
- Front matter is between first `---` and second `---`
- Everything after second `---` is the prompt template
- Prompt template may be empty (spec allows minimal default)

## Files to Create/Modify

```
packages/symphony/src/config/
├── schema.ts          # (from 002)
├── errors.ts          # Add FileNotFound, ParseFailed
├── loader.ts          # ConfigLoader service
├── index.ts           # Export ConfigLoader
└── loader.test.ts     # Unit tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const loader = yield* ConfigLoader
  const { config, promptTemplate } = yield* loader.load("./WORKFLOW.md")
  console.log(config.tracker.project_slug)
  console.log(promptTemplate)
})

const runnable = program.pipe(
  Effect.provide(ConfigLoaderLive)
)
```
