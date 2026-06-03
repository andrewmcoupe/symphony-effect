import { Data } from "effect";

export class UnsupportedKind extends Data.TaggedError("TrackerError.UnsupportedKind")<{
  readonly kind: string;
}> {
  override get message(): string {
    return `Unsupported tracker kind: ${this.kind}`;
  }
}

export class MissingApiKey extends Data.TaggedError("TrackerError.MissingApiKey")<{}> {
  override get message(): string {
    return "Missing Linear API key";
  }
}

export class MissingProjectSlug extends Data.TaggedError("TrackerError.MissingProjectSlug")<{}> {
  override get message(): string {
    return "Missing Linear project slug";
  }
}

export class RequestFailed extends Data.TaggedError("TrackerError.RequestFailed")<{
  readonly endpoint: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Linear request to ${this.endpoint} failed: ${this.reason}`;
  }
}

export class ApiError extends Data.TaggedError("TrackerError.ApiError")<{
  readonly endpoint: string;
  readonly reason: string;
  readonly status?: number;
}> {
  override get message(): string {
    const status = this.status === undefined ? "" : ` (${this.status})`;
    return `Linear API error${status} at ${this.endpoint}: ${this.reason}`;
  }
}

export class UnknownPayload extends Data.TaggedError("TrackerError.UnknownPayload")<{
  readonly reason: string;
}> {
  override get message(): string {
    return `Linear returned an unexpected payload: ${this.reason}`;
  }
}

export type TrackerError =
  | UnsupportedKind
  | MissingApiKey
  | MissingProjectSlug
  | RequestFailed
  | ApiError
  | UnknownPayload;
