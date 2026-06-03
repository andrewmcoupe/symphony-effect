# 006: Workspace Manager

## Summary
Implement workspace lifecycle management: directory creation, path sanitization, and safety invariants.

## Dependencies
- 001-project-setup
- 002-config-schema

## Acceptance Criteria

- [x] `WorkspaceManager` Effect service defined
- [x] `sanitizeIdentifier(identifier: string)` function:
  - Replace non-`[A-Za-z0-9._-]` characters with `_`
  - Handle edge cases (empty string, all special chars)
- [x] `getWorkspacePath(identifier: string)` method:
  - Returns `{workspace.root}/{sanitized_identifier}/`
  - Validates path is under workspace root (prefix check)
- [x] `ensureWorkspace(identifier: string)` method:
  - Creates directory if missing
  - Returns `{ path: string, createdNow: boolean }`
  - Idempotent (safe to call multiple times)
- [x] `removeWorkspace(identifier: string)` method:
  - Removes workspace directory recursively
  - Safe if directory doesn't exist
- [x] Safety invariants:
  - Path must be under configured root (prevent traversal)
  - Sanitization prevents `..` and `/` injection
- [x] `WorkspaceError` type:
  - `WorkspaceError.CreationFailed`
  - `WorkspaceError.PathViolation`
  - `WorkspaceError.RemovalFailed`
- [x] `WorkspaceManagerLive` layer using `@effect/platform` FileSystem
- [x] Unit tests:
  - Path sanitization cases
  - Directory creation (new and existing)
  - Path traversal rejection
  - Removal (existing and non-existing)

## Technical Notes

- Use `@effect/platform/FileSystem` for directory operations
- Resolve `~` in workspace root during config loading (task 002)
- Path validation: `resolvedPath.startsWith(resolvedRoot)`
- Use `path.resolve()` before prefix check to handle `..`

## Files to Create

```
packages/symphony/src/workspace/
├── types.ts           # WorkspaceInfo type
├── errors.ts          # WorkspaceError union
├── sanitize.ts        # sanitizeIdentifier function
├── manager.ts         # WorkspaceManager service
├── index.ts           # Public exports
├── sanitize.test.ts   # Sanitization tests
└── manager.test.ts    # Manager tests
```

## Example Usage

```typescript
const program = Effect.gen(function* () {
  const workspace = yield* WorkspaceManager

  const { path, createdNow } = yield* workspace.ensureWorkspace("ABC-123")
  console.log(`Workspace at ${path}, new: ${createdNow}`)

  // Later...
  yield* workspace.removeWorkspace("ABC-123")
})
```
