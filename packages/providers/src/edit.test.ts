import { describe, expect, it } from "vitest";
import {
  DeterministicEditProvider,
  FullFileEditProvider,
  UnifiedDiffEditProvider,
} from "./edit.js";

const original = "export function formatGreeting(name) {\n  return `Hello ${name}`;\n}\n";
const updated = "export function formatGreeting(name) {\n  return `Hello ${name}!`;\n}\n";

describe("EditProvider strategies", () => {
  it("records hashes, syntax, and a unified diff for deterministic edits", async () => {
    const result = await new DeterministicEditProvider(({ originalCode }) =>
      originalCode.replace("Hello ${name}`", "Hello ${name}!`"),
    ).apply({
      originalCode: original,
      requestedEdit: "replace the greeting return value",
      instructions: "Add punctuation",
      filePath: "src/greeting.js",
    });

    expect(result.success).toBe(true);
    expect(result.syntax.status).toBe("passed");
    expect(result.originalSha256).toHaveLength(64);
    expect(result.finalSha256).toHaveLength(64);
    expect(result.unifiedDiff).toContain("@@");
    expect(result.retryCount).toBe(0);
    expect(result.metadata).toBeNull();
  });

  it("applies a unified diff without executing the edited source", async () => {
    const patch = [
      "--- a/src/greeting.js",
      "+++ b/src/greeting.js",
      "@@ -1,3 +1,3 @@",
      " export function formatGreeting(name) {",
      "-  return `Hello ${name}`;",
      "+  return `Hello ${name}!`;",
      " }",
      "",
    ].join("\n");
    const result = await new UnifiedDiffEditProvider().apply({
      originalCode: original,
      requestedEdit: patch,
      instructions: "Apply the supplied patch",
      filePath: "src/greeting.js",
    });

    expect(result.success).toBe(true);
    expect(result.mergedCode).toBe(updated);
    expect(result.syntax.status).toBe("passed");
  });

  it("treats a full-file response as a replacement and reports syntax failures", async () => {
    const result = await new FullFileEditProvider().apply({
      originalCode: original,
      requestedEdit: "export function broken( {",
      instructions: "Return the complete file",
      filePath: "src/greeting.js",
    });

    expect(result.success).toBe(false);
    expect(result.syntax.status).toBe("failed");
    expect(result.finalSha256).toHaveLength(64);
  });
});
