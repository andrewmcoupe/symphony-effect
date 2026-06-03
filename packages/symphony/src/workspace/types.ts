/** Information about a prepared per-issue workspace directory. */
export interface WorkspaceInfo {
  readonly path: string;
  readonly createdNow: boolean;
}

/** Configuration needed by the workspace manager service. */
export interface WorkspaceManagerConfig {
  readonly root: string;
}

/** The workspace lifecycle hook names supported by the workflow config. */
export type HookName = "after_create" | "before_run" | "after_run" | "before_remove";

/** Captured hook process result. Non-zero exits are represented as HookError. */
export interface HookExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
