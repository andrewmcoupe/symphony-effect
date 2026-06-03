export { CreationFailed, PathViolation, RemovalFailed, WorkspaceError } from "./errors.js";
export {
  makeNodeWorkspaceManagerLive,
  makeWorkspaceManager,
  makeWorkspaceManagerLive,
  WorkspaceManager,
  WorkspaceManagerConfig,
  WorkspaceManagerLive,
  type WorkspaceManager as WorkspaceManagerService,
} from "./manager.js";
export { sanitizeIdentifier } from "./sanitize.js";
export type {
  WorkspaceInfo,
  WorkspaceManagerConfig as WorkspaceManagerConfigValue,
} from "./types.js";
