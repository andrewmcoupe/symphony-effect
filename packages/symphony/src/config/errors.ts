import { Data } from "effect";

/**
 * The workflow config file could not be read (it does not exist, or the
 * filesystem refused access).
 */
export class FileNotFound extends Data.TaggedError("ConfigError.FileNotFound")<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Could not read workflow config at ${this.path}: ${this.reason}`;
  }
}

/**
 * The front matter could not be parsed as YAML (syntax error in the block
 * between the opening and closing `---` fences).
 */
export class ParseFailed extends Data.TaggedError("ConfigError.ParseFailed")<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Failed to parse YAML front matter in ${this.path}: ${this.reason}`;
  }
}

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
export type ConfigError = FileNotFound | ParseFailed | MissingEnvVar | ValidationFailed;
