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

export type WorkspaceError = CreationFailed | PathViolation | RemovalFailed;

export const WorkspaceError = {
  CreationFailed,
  PathViolation,
  RemovalFailed,
} as const;
