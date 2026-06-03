import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LoadedConfig } from "../config/index.js";
import { TrackerClient, type Issue, type TrackerClientService } from "../tracker/index.js";
import { NodeHookExecutorLive, makeWorkspaceManagerLive } from "../workspace/index.js";
import { cleanupTerminalIssueWorkspaces } from "./startup.js";

let workspaceRoot: string | undefined;

const loadedConfig = (root: string, hookLog: string): LoadedConfig => ({
  config: {
    tracker: {
      kind: "linear",
      endpoint: "https://linear.example/graphql",
      api_key: "token",
      project_slug: "project",
      active_states: ["Todo", "In Progress"],
      terminal_states: ["Done", "Cancelled"],
    },
    polling: { interval_ms: 1_000 },
    workspace: { root },
    hooks: {
      timeout_ms: 1_000,
      before_remove: `printf '%s\\n' "$ISSUE_IDENTIFIER" >> '${hookLog}'`,
    },
    agent: {
      max_concurrent_agents: 2,
      max_turns: 4,
      stall_timeout_ms: 300_000,
      max_retry_backoff_ms: 300_000,
    },
  },
  promptTemplate: "Work on {{ issue.identifier }}",
});

const makeIssue = (identifier: string, state: string): Issue => ({
  id: identifier,
  identifier,
  title: identifier,
  description: "",
  priority: null,
  state,
  branchName: identifier.toLowerCase(),
  url: `https://linear.example/${identifier}`,
  labels: [],
  blockedBy: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const makeTracker = (issues: Issue[]): TrackerClientService => ({
  fetchCandidateIssues: () => Effect.succeed([]),
  fetchIssuesByStates: () => Effect.succeed(issues),
  fetchIssueStatesByIds: () => Effect.succeed(new Map()),
});

const runCleanup = (loaded: LoadedConfig, tracker: TrackerClientService) =>
  Effect.runPromise(
    cleanupTerminalIssueWorkspaces(loaded).pipe(
      Effect.provide(Layer.succeed(TrackerClient, tracker)),
      Effect.provide(makeWorkspaceManagerLive(loaded.config.workspace.root)),
      Effect.provide(NodeHookExecutorLive),
      Effect.provide(NodeFileSystem.layer),
    ),
  );

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "symphony-startup-"));
});

afterEach(async () => {
  if (workspaceRoot !== undefined) {
    await rm(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = undefined;
  }
});

describe("startup cleanup", () => {
  it("removes existing workspaces that match terminal issue identifiers", async () => {
    if (workspaceRoot === undefined) throw new Error("workspaceRoot was not initialized");
    const hookLog = path.join(workspaceRoot, "hook.log");
    const activeWorkspace = path.join(workspaceRoot, "ABC-3");

    await mkdir(path.join(workspaceRoot, "ABC-1"));
    await mkdir(path.join(workspaceRoot, "ABC_2"));
    await mkdir(activeWorkspace);
    await writeFile(path.join(workspaceRoot, "not-a-workspace.txt"), "ignore");

    await runCleanup(
      loadedConfig(workspaceRoot, hookLog),
      makeTracker([
        makeIssue("ABC-1", "Done"),
        makeIssue("ABC/2", "Cancelled"),
        makeIssue("MISSING-1", "Done"),
      ]),
    );

    await expect(stat(path.join(workspaceRoot, "ABC-1"))).rejects.toThrow();
    await expect(stat(path.join(workspaceRoot, "ABC_2"))).rejects.toThrow();
    expect((await stat(activeWorkspace)).isDirectory()).toBe(true);
    await expect(stat(path.join(workspaceRoot, "not-a-workspace.txt"))).resolves.toBeDefined();
    await expect(readFile(hookLog, "utf8")).resolves.toBe("ABC-1\nABC/2\n");
  });
});
