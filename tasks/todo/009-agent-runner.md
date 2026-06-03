# 009: Agent Runner (Claude Code)

## Summary
Implement the agent runner that invokes Claude Code as a subprocess for single-turn execution.

## Dependencies
- 001-project-setup
- 006-workspace-manager
- 008-prompt-renderer

## Acceptance Criteria

- [ ] `AgentRunner` Effect service defined
- [ ] `runTurn(params: TurnParams)` method:
  ```typescript
  interface TurnParams {
    prompt: string
    workspacePath: string
    timeoutMs: number
  }

  interface TurnResult {
    success: boolean
    output: string
    exitCode: number
    tokensUsed?: TokenUsage
  }
  ```
- [ ] Invokes Claude Code:
  ```bash
  claude -p "<prompt>" --output-format json
  ```
- [ ] Working directory set to workspace path
- [ ] Timeout enforcement (kills process if exceeded)
- [ ] JSON output parsing for structured result
- [ ] `AgentError` type:
  - `AgentError.SpawnFailed`
  - `AgentError.TimedOut`
  - `AgentError.OutputParseFailed`
  - `AgentError.NonZeroExit`
- [ ] `AgentRunnerLive` layer using `@effect/platform` Command
- [ ] Proper cleanup on interruption (kill subprocess)
- [ ] Unit tests with mocked subprocess:
  - Successful execution
  - Timeout handling
  - Non-zero exit
  - JSON parse failure

## Technical Notes

- Use `@effect/platform/Command` for subprocess
- Single-turn model: each invocation is a new subprocess
- The orchestrator decides whether to run another turn
- Parse Claude Code's JSON output format (investigate actual structure)
- Token usage may be in output (extract if available)

## Open Questions (resolve during implementation)

- Exact JSON structure from `claude --output-format json`
- How to extract token usage from output
- Error message format from Claude Code

## Files to Create

```
packages/symphony/src/agent/
├── types.ts           # TurnParams, TurnResult, TokenUsage
├── errors.ts          # AgentError union
├── runner.ts          # AgentRunner service
├── index.ts           # Public exports
└── runner.test.ts     # Unit tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const agent = yield* AgentRunner

  const result = yield* agent.runTurn({
    prompt: "Fix the bug in auth.ts",
    workspacePath: "/workspaces/ABC-123",
    timeoutMs: 3600000
  })

  if (result.success) {
    console.log("Turn completed:", result.output)
  }
})
```
