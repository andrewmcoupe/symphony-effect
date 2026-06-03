import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import type { Issue } from "../tracker/types.js";
import { PromptRenderer, PromptRendererLive, RenderError } from "./renderer.js";

const issue: Issue = {
  id: "issue-id",
  identifier: "ABC-123",
  title: "Render prompt templates",
  description: "Implement strict Liquid prompt rendering.",
  priority: null,
  state: "Todo",
  branchName: "andy/abc-123-render-prompt-templates",
  url: "https://linear.app/example/issue/ABC-123",
  labels: ["backend", "agent"],
  blockedBy: [],
  createdAt: new Date("2026-06-01T09:00:00.000Z"),
  updatedAt: new Date("2026-06-02T10:00:00.000Z"),
};

const render = (template: string, attempt: number | null = null) =>
  Effect.runSync(
    Effect.either(
      Effect.gen(function* () {
        const renderer = yield* PromptRenderer;
        return yield* renderer.render(template, { issue, attempt });
      }).pipe(Effect.provide(PromptRendererLive)),
    ),
  );

describe("PromptRenderer", () => {
  it("renders basic variable substitution", () => {
    const result = render("Title: {{ issue.title }}");

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBe("Title: Render prompt templates");
    }
  });

  it("renders nested access with built-in filters", () => {
    const result = render('Labels: {{ issue.labels | join: ", " | upcase }}');

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBe("Labels: BACKEND, AGENT");
    }
  });

  it("renders conditionals using the attempt variable", () => {
    const firstRun = render("{% if attempt %}retry {{ attempt }}{% endif %}", null);
    const retry = render("{% if attempt %}retry {{ attempt }}{% endif %}", 2);

    expect(Either.isRight(firstRun)).toBe(true);
    expect(Either.isRight(retry)).toBe(true);
    if (Either.isRight(firstRun) && Either.isRight(retry)) {
      expect(firstRun.right).toBe("");
      expect(retry.right).toBe("retry 2");
    }
  });

  it("renders the default filter for null values", () => {
    const result = render('Priority: {{ issue.priority | default: "None" }}');

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBe("Priority: None");
    }
  });

  it("fails with UnknownVariable for unknown variables", () => {
    const result = render("{{ missing.value }}");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RenderError.UnknownVariable);
      expect(result.left.variable).toBe("missing");
    }
  });

  it("fails with UnknownFilter for unknown filters", () => {
    const result = render("{{ issue.title | titlecase }}");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RenderError.UnknownFilter);
      expect(result.left.filter).toBe("titlecase");
    }
  });

  it("fails with SyntaxError for invalid Liquid syntax", () => {
    const result = render("{% if");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RenderError.SyntaxError);
    }
  });
});
