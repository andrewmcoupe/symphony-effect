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
    };

// Small sliding buffer: dashboard SSE consumers need recent signals, and publishers must never block.
export const makeDomainEventPubSub = PubSub.sliding<DomainEvent>(64);
