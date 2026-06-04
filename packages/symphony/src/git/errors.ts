import { Data } from "effect";

export class UnsupportedKind extends Data.TaggedError("GitProviderError.UnsupportedKind")<{
  readonly kind: string;
}> {
  override get message(): string {
    return `Unsupported git provider kind: ${this.kind}`;
  }
}

export class MissingToken extends Data.TaggedError("GitProviderError.MissingToken")<{}> {
  override get message(): string {
    return "Missing git provider token";
  }
}

export class MissingRepository extends Data.TaggedError("GitProviderError.MissingRepository")<{}> {
  override get message(): string {
    return "Missing git provider repository";
  }
}

export class RequestFailed extends Data.TaggedError("GitProviderError.RequestFailed")<{
  readonly endpoint: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Git provider request to ${this.endpoint} failed: ${this.reason}`;
  }
}

export class ApiError extends Data.TaggedError("GitProviderError.ApiError")<{
  readonly endpoint: string;
  readonly reason: string;
  readonly status?: number;
}> {
  override get message(): string {
    const status = this.status === undefined ? "" : ` (${this.status})`;
    return `Git provider API error${status} at ${this.endpoint}: ${this.reason}`;
  }
}

export class UnknownPayload extends Data.TaggedError("GitProviderError.UnknownPayload")<{
  readonly reason: string;
}> {
  override get message(): string {
    return `Git provider returned an unexpected payload: ${this.reason}`;
  }
}

export type GitProviderError =
  | UnsupportedKind
  | MissingToken
  | MissingRepository
  | RequestFailed
  | ApiError
  | UnknownPayload;
