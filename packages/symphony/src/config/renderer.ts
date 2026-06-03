import { Data, Effect, Layer } from "effect";
import {
  Liquid,
  ParseError as LiquidParseError,
  TokenizationError as LiquidTokenizationError,
  UndefinedVariableError,
} from "liquidjs";
import type { Issue } from "../tracker/types.js";

export interface PromptVariables {
  readonly issue: Issue;
  readonly attempt: number | null;
}

export class UnknownVariable extends Data.TaggedError("RenderError.UnknownVariable")<{
  readonly variable: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Unknown prompt template variable "${this.variable}": ${this.reason}`;
  }
}

export class UnknownFilter extends Data.TaggedError("RenderError.UnknownFilter")<{
  readonly filter: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Unknown prompt template filter "${this.filter}": ${this.reason}`;
  }
}

export class RenderSyntaxError extends Data.TaggedError("RenderError.SyntaxError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return `Prompt template syntax error: ${this.reason}`;
  }
}

export type RenderError = UnknownVariable | UnknownFilter | RenderSyntaxError;

export const RenderError = {
  UnknownVariable,
  UnknownFilter,
  SyntaxError: RenderSyntaxError,
} as const;

export interface PromptRendererShape {
  readonly render: (
    template: string,
    variables: PromptVariables,
  ) => Effect.Effect<string, RenderError>;
}

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

const getErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const getOriginalMessage = (cause: unknown): string | undefined => {
  if (cause instanceof Error && "originalError" in cause && cause.originalError instanceof Error) {
    return cause.originalError.message;
  }

  return undefined;
};

const extractName = (message: string, pattern: RegExp, fallback: string): string =>
  pattern.exec(message)?.[1] ?? fallback;

const toRenderError = (cause: unknown): RenderError => {
  const message = getErrorMessage(cause);
  const originalMessage = getOriginalMessage(cause);
  const classificationMessage = originalMessage ?? message;

  if (
    cause instanceof UndefinedVariableError ||
    classificationMessage.startsWith("undefined variable:")
  ) {
    return new UnknownVariable({
      variable: extractName(classificationMessage, /^undefined variable: ([^,\s]+)/u, "unknown"),
      reason: message,
    });
  }

  if (classificationMessage.startsWith("undefined filter:")) {
    return new UnknownFilter({
      filter: extractName(classificationMessage, /^undefined filter: ([^,\s]+)/u, "unknown"),
      reason: message,
    });
  }

  if (cause instanceof LiquidParseError || cause instanceof LiquidTokenizationError) {
    return new RenderSyntaxError({ reason: message });
  }

  return new RenderSyntaxError({ reason: message });
};

export class PromptRenderer extends Effect.Service<PromptRenderer>()("symphony/PromptRenderer", {
  sync: () =>
    ({
      render: (template, variables) =>
        Effect.try({
          try: () => String(engine.parseAndRenderSync(template, variables)),
          catch: toRenderError,
        }),
    }) satisfies PromptRendererShape,
}) {}

export const PromptRendererLive: Layer.Layer<PromptRenderer> = PromptRenderer.Default;
