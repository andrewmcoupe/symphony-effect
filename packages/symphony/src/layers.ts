import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node";
import { Layer } from "effect";
import { AgentRunnerLive } from "./agent/index.js";
import { ConfigLoader, PromptRendererLive, type LoadedConfig } from "./config/index.js";
import { HttpServerLive } from "./observability/index.js";
import {
  makeConcurrencyControllerLive,
  makeOrchestratorLive,
  OrchestratorRefreshLive,
  OrchestratorStateRefLive,
  ReconcilerLive,
} from "./orchestrator/index.js";
import { makeLinearClientLive } from "./tracker/index.js";
import { HookExecutorLive, makeWorkspaceManagerLive } from "./workspace/index.js";

export const makeMainLive = ({
  loaded,
  workflowPath,
}: {
  readonly loaded: LoadedConfig;
  readonly workflowPath: string;
}) => {
  const base = Layer.mergeAll(NodeFileSystem.layer, NodeCommandExecutor.layer).pipe(
    Layer.provideMerge(ConfigLoader.Default),
    Layer.provideMerge(PromptRendererLive),
    Layer.provideMerge(OrchestratorStateRefLive),
    Layer.provideMerge(OrchestratorRefreshLive),
  );

  return base.pipe(
    Layer.provideMerge(makeLinearClientLive(workflowPath)),
    Layer.provideMerge(makeWorkspaceManagerLive(loaded.config.workspace.root)),
    Layer.provideMerge(HookExecutorLive),
    Layer.provideMerge(AgentRunnerLive),
    Layer.provideMerge(makeConcurrencyControllerLive(loaded.config.agent)),
    Layer.provideMerge(ReconcilerLive),
    Layer.provideMerge(makeOrchestratorLive({ workflowPath })),
    Layer.provideMerge(HttpServerLive),
  );
};
