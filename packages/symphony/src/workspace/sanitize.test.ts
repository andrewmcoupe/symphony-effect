import { describe, expect, it } from "vitest";
import { sanitizeIdentifier } from "./sanitize.js";

describe("sanitizeIdentifier", () => {
  it("keeps safe identifier characters", () => {
    expect(sanitizeIdentifier("ABC-123_foo.bar")).toBe("ABC-123_foo.bar");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeIdentifier("ABC/123 some:thing")).toBe("ABC_123_some_thing");
  });

  it("handles empty identifiers", () => {
    expect(sanitizeIdentifier("")).toBe("_");
  });

  it("handles identifiers made only from special characters", () => {
    expect(sanitizeIdentifier("///")).toBe("___");
  });
});
