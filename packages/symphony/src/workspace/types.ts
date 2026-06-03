/** Information about a prepared per-issue workspace directory. */
export interface WorkspaceInfo {
  readonly path: string;
  readonly createdNow: boolean;
}

/** Configuration needed by the workspace manager service. */
export interface WorkspaceManagerConfig {
  readonly root: string;
}
