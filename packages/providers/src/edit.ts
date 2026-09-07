import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { ProviderCallMetadata } from "./provider-types.js";
import type { FastApplyInput, MorphClient } from "./index.js";

export type SyntaxCheck = {
  status: "passed" | "failed" | "not_checked";
  message?: string;
};

export type EditInput = {
  originalCode: string;
  requestedEdit: string;
  instructions: string;
  filePath?: string;
  language?: "javascript" | "typescript" | "unknown";
};

export type EditResult = {
  provider: string;
  success: boolean;
  originalSha256: string;
  requestedEdit: string;
  mergedCode?: string;
  finalSha256?: string;
  unifiedDiff: string;
  syntax: SyntaxCheck;
  retryCount: number;
  latencyMs: number;
  metadata: ProviderCallMetadata | null;
  error?: string;
};

export interface EditProvider {
  readonly id: string;
  apply(input: EditInput): Promise<EditResult>;
}

export type DeterministicEditTransform = (input: EditInput) => string;

/** A deterministic edit strategy used as the controlled local baseline. */
export class DeterministicEditProvider implements EditProvider {
  readonly id = "deterministic-edit";

  constructor(private readonly transform: DeterministicEditTransform) {}

  async apply(input: EditInput): Promise<EditResult> {
    const startedAt = performance.now();
    try {
      return makeEditResult({
        provider: this.id,
        input,
        mergedCode: this.transform(input),
        retryCount: 0,
        latencyMs: performance.now() - startedAt,
      });
    } catch (error) {
      throw editError(this.id, input, startedAt, error);
    }
  }
}

/** Applies a unified diff in memory and returns the resulting full file. */
export class UnifiedDiffEditProvider implements EditProvider {
  readonly id = "unified-diff";

  async apply(input: EditInput): Promise<EditResult> {
    const startedAt = performance.now();
    try {
      return makeEditResult({
        provider: this.id,
        input,
        mergedCode: applyUnifiedDiff(input.originalCode, input.requestedEdit),
        retryCount: 0,
        latencyMs: performance.now() - startedAt,
      });
    } catch (error) {
      throw editError(this.id, input, startedAt, error);
    }
  }
}

/** Treats a generated full-file response as the proposed replacement. */
export class FullFileEditProvider implements EditProvider {
  readonly id = "full-file";

  async apply(input: EditInput): Promise<EditResult> {
    const startedAt = performance.now();
    return makeEditResult({
      provider: this.id,
      input,
      mergedCode: input.requestedEdit,
      retryCount: 0,
      latencyMs: performance.now() - startedAt,
    });
  }
}

/** Morph's Fast Apply behind the same EditProvider contract as local strategies. */
export class MorphFastApplyEditProvider implements EditProvider {
  readonly id = "fast-apply";

  constructor(private readonly client: Pick<MorphClient, "fastApply">) {}

  async apply(input: EditInput): Promise<EditResult> {
    const fastApplyInput: FastApplyInput = {
      originalCode: input.originalCode,
      codeEdit: input.requestedEdit,
      instructions: input.instructions,
    };
    const result = await this.client.fastApply(fastApplyInput);
    if (!result.mergedCode || !result.finalSha256) {
      throw editError(
        this.id,
        input,
        performance.now(),
        new Error(result.error ?? "Fast Apply returned no merged code"),
      );
    }
    const syntax = validateSyntax(result.mergedCode, input);
    return {
      provider: this.id,
      success: result.success && syntax.status !== "failed",
      originalSha256: result.originalSha256,
      requestedEdit: input.requestedEdit,
      mergedCode: result.mergedCode,
      finalSha256: result.finalSha256,
      unifiedDiff:
        result.udiff ?? unifiedDiff(input.originalCode, result.mergedCode, input.filePath),
      syntax,
      retryCount: 0,
      latencyMs: result.metadata.latencyMs,
      metadata: result.metadata,
      ...(syntax.status === "failed" ? { error: syntax.message } : {}),
    };
  }
}

function makeEditResult(input: {
  provider: string;
  input: EditInput;
  mergedCode: string;
  retryCount: number;
  latencyMs: number;
}): EditResult {
  const syntax = validateSyntax(input.mergedCode, input.input);
  return {
    provider: input.provider,
    success: syntax.status !== "failed",
    originalSha256: sha256(input.input.originalCode),
    requestedEdit: input.input.requestedEdit,
    mergedCode: input.mergedCode,
    finalSha256: sha256(input.mergedCode),
    unifiedDiff: unifiedDiff(input.input.originalCode, input.mergedCode, input.input.filePath),
    syntax,
    retryCount: input.retryCount,
    latencyMs: input.latencyMs,
    metadata: null,
    ...(syntax.status === "failed" ? { error: syntax.message } : {}),
  };
}

function validateSyntax(code: string, input: EditInput): SyntaxCheck {
  const language = input.language ?? languageFromPath(input.filePath);
  if (language !== "javascript") return { status: "not_checked" };
  const directory = mkdtempSync(join(tmpdir(), "morphscope-edit-"));
  const filename = join(directory, "candidate.mjs");
  try {
    writeFileSync(filename, code, { encoding: "utf8", mode: 0o600 });
    const result = spawnSync(process.execPath, ["--check", filename], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      shell: false,
    });
    if (result.error) return { status: "failed", message: result.error.message.slice(0, 512) };
    if (result.status === 0) return { status: "passed" };
    return {
      status: "failed",
      message: `${result.stderr || result.stdout || "JavaScript syntax check failed"}`
        .trim()
        .slice(0, 512),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function languageFromPath(filePath: string | undefined): EditInput["language"] {
  if (!filePath) return "unknown";
  if (/\.(?:c?js|mjs|cjs)$/u.test(filePath)) return "javascript";
  if (/\.(?:ts|tsx)$/u.test(filePath)) return "typescript";
  return "unknown";
}

function applyUnifiedDiff(original: string, patch: string): string {
  const patchLines = patch.split(/\r?\n/);
  const hunkIndexes = patchLines
    .map((line, index) => (line.startsWith("@@") ? index : -1))
    .filter((index) => index >= 0);
  if (hunkIndexes.length === 0) throw new Error("Unified diff does not contain a hunk");

  const originalLines = original.split(/\r?\n/);
  const output: string[] = [];
  let originalCursor = 0;
  for (let hunkIndex = 0; hunkIndex < hunkIndexes.length; hunkIndex += 1) {
    const start = hunkIndexes[hunkIndex];
    const header = patchLines[start];
    const match = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (!match) throw new Error(`Invalid unified diff hunk header: ${header}`);
    const hunkStart = Number(match[1]) - 1;
    if (hunkStart < originalCursor || hunkStart > originalLines.length)
      throw new Error("Unified diff hunk is out of order");
    output.push(...originalLines.slice(originalCursor, hunkStart));
    originalCursor = hunkStart;
    const end = hunkIndexes[hunkIndex + 1] ?? patchLines.length;
    for (const line of patchLines.slice(start + 1, end)) {
      if (line.startsWith("\\ No newline")) continue;
      const marker = line[0];
      const content = line.slice(1);
      if (marker === " ") {
        if (originalLines[originalCursor] !== content)
          throw new Error("Unified diff context does not match the original file");
        output.push(content);
        originalCursor += 1;
      } else if (marker === "-") {
        if (originalLines[originalCursor] !== content)
          throw new Error("Unified diff removal does not match the original file");
        originalCursor += 1;
      } else if (marker === "+") {
        output.push(content);
      } else if (line.length > 0) {
        throw new Error(`Unexpected unified diff line: ${line}`);
      }
    }
  }
  output.push(...originalLines.slice(originalCursor));
  return output.join("\n");
}

function unifiedDiff(before: string, after: string, filePath = "file"): string {
  if (before === after) return "";
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function editError(provider: string, input: EditInput, startedAt: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const result = makeEditResult({
    provider,
    input,
    mergedCode: input.originalCode,
    retryCount: 0,
    latencyMs: performance.now() - startedAt,
  });
  return Object.assign(new Error(`${provider} edit failed: ${message}`), {
    result: { ...result, success: false, error: message.slice(0, 512) },
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
