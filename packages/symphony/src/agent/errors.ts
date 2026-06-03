import { Data } from "effect";

export class SpawnFailed extends Data.TaggedError("AgentError.SpawnFailed")<{
  readonly workspacePath: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Failed to spawn Claude Code in ${this.workspacePath}: ${this.reason}`;
  }
}

export class TimedOut extends Data.TaggedError("AgentError.TimedOut")<{
  readonly workspacePath: string;
  readonly timeoutMs: number;
}> {
  override get message(): string {
    return `Claude Code timed out after ${this.timeoutMs}ms in ${this.workspacePath}`;
  }
}

export class OutputParseFailed extends Data.TaggedError("AgentError.OutputParseFailed")<{
  readonly workspacePath: string;
  readonly output: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Failed to parse Claude Code JSON output in ${this.workspacePath}: ${this.reason}`;
  }
}

export class NonZeroExit extends Data.TaggedError("AgentError.NonZeroExit")<{
  readonly workspacePath: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return `Claude Code exited with code ${this.exitCode} in ${this.workspacePath}`;
  }
}

export type AgentError = SpawnFailed | TimedOut | OutputParseFailed | NonZeroExit;

export const AgentError = {
  SpawnFailed,
  TimedOut,
  OutputParseFailed,
  NonZeroExit,
} as const;
