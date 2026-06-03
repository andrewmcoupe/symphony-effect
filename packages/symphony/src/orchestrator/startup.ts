import { Effect } from "effect";
import type { LoadedConfig } from "../config/index.js";
import { TrackerClient, type Issue } from "../tracker/index.js";
import { HookExecutor, sanitizeIdentifier, WorkspaceManager } from "../workspace/index.js";

const terminalIssueByDirectory = (issues: readonly Issue[]): Map<string, Issue> => {
  const byDirectory = new Map<string, Issue>();

  for (const issue of issues) {
    byDirectory.set(sanitizeIdentifier(issue.identifier), issue);
  }

  return byDirectory;
};

const cleanWorkspace = (
  issue: Issue,
  loaded: LoadedConfig,
): Effect.Effect<boolean, never, HookExecutor | WorkspaceManager> =>
  Effect.gen(function* () {
    const hookExecutor = yield* HookExecutor;
    const workspaceManager = yield* WorkspaceManager;
    const workspacePath = yield* workspaceManager.getWorkspacePath(issue.identifier);

    yield* Effect.logInfo(`Cleaning workspace: ${issue.identifier} (issue state: ${issue.state})`);

    yield* hookExecutor
      .executeLifecycleHook({
        hook: loaded.config.hooks.before_remove,
        hookName: "before_remove",
        workspacePath,
        timeoutMs: loaded.config.hooks.timeout_ms,
        issueIdentifier: issue.identifier,
      })
      .pipe(Effect.catchAll((error) => Effect.logWarning(error.message)));

    yield* workspaceManager.removeWorkspace(issue.identifier);
    yield* Effect.logInfo(`Cleaned workspace: ${issue.identifier}`);
    return true;
  }).pipe(Effect.catchAll((error) => Effect.logWarning(error.message).pipe(Effect.as(false))));

export const cleanupTerminalIssueWorkspaces = (
  loaded: LoadedConfig,
): Effect.Effect<void, never, HookExecutor | TrackerClient | WorkspaceManager> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting cleanup of stale workspaces...");

    const tracker = yield* TrackerClient;
    const workspaceManager = yield* WorkspaceManager;

    const terminalIssues = yield* tracker
      .fetchIssuesByStates(loaded.config.tracker.terminal_states)
      .pipe(
        Effect.catchAll((error) => Effect.logWarning(error.message).pipe(Effect.as([] as Issue[]))),
      );
    yield* Effect.logInfo(`Found ${terminalIssues.length} terminal issues`);

    const directories = yield* workspaceManager
      .listWorkspaceDirectories()
      .pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(error.message).pipe(Effect.as([] as string[])),
        ),
      );
    yield* Effect.logInfo(`Found ${directories.length} workspace directories`);

    const issuesByDirectory = terminalIssueByDirectory(terminalIssues);
    const cleaned = yield* Effect.forEach(
      directories,
      (directory) => {
        const issue = issuesByDirectory.get(directory);
        return issue === undefined ? Effect.succeed(false) : cleanWorkspace(issue, loaded);
      },
      { concurrency: 1 },
    );

    const removedCount = cleaned.filter(Boolean).length;
    yield* Effect.logInfo(`Startup cleanup complete: removed ${removedCount} workspaces`);
  });
