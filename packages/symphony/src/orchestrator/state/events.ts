import { PubSub } from "effect";

export type DomainEvent =
  | {
      readonly _tag: "TurnRecorded";
      readonly issueId: string;
      readonly identifier: string;
    }
  | {
      readonly _tag: "IssueStateChanged";
      readonly issueId: string;
      readonly identifier: string;
    }
  | {
      readonly _tag: "TokenTotalsChanged";
      readonly tokenTotals: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens: number;
        readonly runtimeSeconds: number;
      };
    };

// Small sliding buffer: dashboard SSE consumers need recent signals, and publishers must never block.
export const makeDomainEventPubSub = PubSub.sliding<DomainEvent>(64);
