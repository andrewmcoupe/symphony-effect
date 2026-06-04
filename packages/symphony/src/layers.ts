import { NodeCommandExecutor, NodeFileSystem } from "@effect/platform-node";
import { Layer } from "effect";
import { makeAgentRunnerLive } from "./agent/index.js";
import { ConfigLoader, PromptRendererLive, type LoadedConfig } from "./config/index.js";
import { makeGitProviderLive } from "./git/index.js";
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
  const platform = NodeCommandExecutor.layer.pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.provideMerge(NodeFileSystem.layer),
  );

  const config = ConfigLoader.Default.pipe(Layer.provideMerge(platform));
  const renderer = PromptRendererLive.pipe(Layer.provideMerge(config));
  const state = OrchestratorStateRefLive.pipe(Layer.provideMerge(renderer));
  const refresh = OrchestratorRefreshLive.pipe(Layer.provideMerge(state));
  const tracker = makeLinearClientLive(workflowPath).pipe(Layer.provideMerge(refresh));
  const git = makeGitProviderLive(workflowPath).pipe(Layer.provideMerge(tracker));
  const workspace = makeWorkspaceManagerLive(loaded.config.workspace.root).pipe(
    Layer.provideMerge(git),
  );
  const hooks = HookExecutorLive.pipe(Layer.provideMerge(workspace));
  const agent = makeAgentRunnerLive({
    maxTurns: loaded.config.agent.max_turns,
    ...(loaded.config.agent.model === undefined ? {} : { model: loaded.config.agent.model }),
  }).pipe(Layer.provideMerge(hooks));
  const concurrency = makeConcurrencyControllerLive(loaded.config.agent).pipe(
    Layer.provideMerge(agent),
  );
  const reconciler = ReconcilerLive.pipe(Layer.provideMerge(concurrency));
  const orchestrator = makeOrchestratorLive({ workflowPath }).pipe(Layer.provideMerge(reconciler));

  return HttpServerLive.pipe(Layer.provideMerge(orchestrator));
};
