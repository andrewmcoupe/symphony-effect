import { Data } from "effect";

/**
 * A referenced environment variable (e.g. `$LINEAR_API_KEY`) was not present
 * in the process environment when resolving the workflow config.
 */
export class MissingEnvVar extends Data.TaggedError("ConfigError.MissingEnvVar")<{
  readonly varName: string;
}> {
  override get message(): string {
    return `Missing environment variable: $${this.varName}`;
  }
}

/**
 * The workflow config failed structural/schema validation (bad shape, wrong
 * type, empty required array, unsupported tracker kind, etc.).
 */
export class ValidationFailed extends Data.TaggedError("ConfigError.ValidationFailed")<{
  readonly reason: string;
}> {
  override get message(): string {
    return `Config validation failed:\n${this.reason}`;
  }
}

/** Union of all errors that can arise while loading/validating the config. */
export type ConfigError = MissingEnvVar | ValidationFailed;
