# 008: Prompt Template Renderer

## Summary
Implement Liquid template rendering for prompt templates with strict mode.

## Dependencies
- 001-project-setup
- 004-tracker-abstraction

## Acceptance Criteria

- [ ] `PromptRenderer` Effect service defined
- [ ] `render(template: string, variables: PromptVariables)` method:
  - Uses LiquidJS engine
  - Strict mode: unknown variables fail
  - Strict mode: unknown filters fail
  - Returns rendered string
- [ ] `PromptVariables` type:
  ```typescript
  interface PromptVariables {
    issue: Issue
    attempt: number | null  // null on first run, >= 1 on retry
  }
  ```
- [ ] Built-in Liquid filters work (e.g., `default`, `join`, `upcase`)
- [ ] `RenderError` type:
  - `RenderError.UnknownVariable`
  - `RenderError.UnknownFilter`
  - `RenderError.SyntaxError`
- [ ] `PromptRendererLive` layer (no dependencies, pure)
- [ ] Unit tests:
  - Basic variable substitution (`{{ issue.title }}`)
  - Nested access (`{{ issue.labels | join: ", " }}`)
  - Conditionals (`{% if attempt %}...{% endif %}`)
  - `default` filter (`{{ issue.priority | default: "None" }}`)
  - Unknown variable error
  - Unknown filter error

## Technical Notes

- LiquidJS options: `{ strictVariables: true, strictFilters: true }`
- The `issue` object should be passed as-is (includes all fields)
- `attempt` is null for first run, integer >= 1 for retries
- Template syntax is Liquid (not Jinja, not Mustache)

## Files to Create

```
packages/symphony/src/config/
├── schema.ts          # (existing)
├── errors.ts          # (existing)
├── loader.ts          # (existing)
├── renderer.ts        # PromptRenderer service
├── index.ts           # Export PromptRenderer
└── renderer.test.ts   # Renderer tests
```

## Example Template

```liquid
You are working on issue {{ issue.identifier }}.

**Title:** {{ issue.title }}
**Priority:** {{ issue.priority | default: "Unset" }}
**Labels:** {{ issue.labels | join: ", " }}

{% if attempt %}
This is retry attempt {{ attempt }}.
{% endif %}
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const renderer = yield* PromptRenderer

  const prompt = yield* renderer.render(template, {
    issue: myIssue,
    attempt: null  // first run
  })

  console.log(prompt)
})
```
