import { Data } from "effect";

export class CreationFailed extends Data.TaggedError("WorkspaceError.CreationFailed")<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Failed to create workspace at ${this.path}: ${this.reason}`;
  }
}

export class PathViolation extends Data.TaggedError("WorkspaceError.PathViolation")<{
  readonly root: string;
  readonly path: string;
  readonly identifier: string;
}> {
  override get message(): string {
    return `Workspace path for ${this.identifier} escapes root ${this.root}: ${this.path}`;
  }
}

export class RemovalFailed extends Data.TaggedError("WorkspaceError.RemovalFailed")<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Failed to remove workspace at ${this.path}: ${this.reason}`;
  }
}

export class HookExecutionFailed extends Data.TaggedError("HookError.ExecutionFailed")<{
  readonly hook: string;
  readonly workspacePath: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Failed to execute hook in ${this.workspacePath}: ${this.reason}`;
  }
}

export class HookTimedOut extends Data.TaggedError("HookError.TimedOut")<{
  readonly hook: string;
  readonly workspacePath: string;
  readonly timeoutMs: number;
}> {
  override get message(): string {
    return `Hook timed out after ${this.timeoutMs}ms in ${this.workspacePath}`;
  }
}

export class HookNonZeroExit extends Data.TaggedError("HookError.NonZeroExit")<{
  readonly hook: string;
  readonly workspacePath: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `Hook exited with code ${this.exitCode} in ${this.workspacePath}`;
  }
}

export type HookError = HookExecutionFailed | HookTimedOut | HookNonZeroExit;

export type WorkspaceError = CreationFailed | PathViolation | RemovalFailed;

export const WorkspaceError = {
  CreationFailed,
  PathViolation,
  RemovalFailed,
} as const;

export const HookError = {
  ExecutionFailed: HookExecutionFailed,
  TimedOut: HookTimedOut,
  NonZeroExit: HookNonZeroExit,
} as const;
