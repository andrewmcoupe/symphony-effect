import { Effect } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SpawnFailed,
  type AgentRunner,
  type TurnParams,
  type TurnResult,
} from "../../agent/index.js";

type MockTurnResponse = TurnResult | Promise<TurnResult> | (() => TurnResult | Promise<TurnResult>);

export interface MockAgent extends AgentRunner {
  readonly calls: TurnParams[];
  readonly enqueue: (response: MockTurnResponse) => void;
}

export const successfulTurn = (output = "ok"): TurnResult => ({
  success: true,
  output,
  exitCode: 0,
  tokensUsed: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
});

export const failedTurn = (output = "failed"): TurnResult => ({
  success: false,
  output,
  exitCode: 1,
});

const resolveResponse = async (response: MockTurnResponse): Promise<TurnResult> =>
  typeof response === "function" ? response() : response;

export const createMockAgent = (
  responses: readonly MockTurnResponse[] = [successfulTurn()],
): MockAgent => {
  const queue = [...responses];
  const calls: TurnParams[] = [];

  return {
    calls,
    enqueue: (response) => {
      queue.push(response);
    },
    runTurn: (params) =>
      Effect.tryPromise({
        try: async () => {
          calls.push(params);
          await mkdir(params.workspacePath, { recursive: true });
          await writeFile(
            path.join(params.workspacePath, `.mock-agent-turn-${calls.length}.txt`),
            params.prompt,
          );
          return resolveResponse(queue.shift() ?? successfulTurn("fallback"));
        },
        catch: (cause) =>
          new SpawnFailed({
            workspacePath: params.workspacePath,
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
      }),
  };
};
